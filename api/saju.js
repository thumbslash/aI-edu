module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { year, month, day, hour, minute, unknownTime, gender } = req.body || {};

  if (!year || !month || !day) {
    res.status(400).json({ error: '생년월일을 입력해주세요.' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '서버에 OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다.' });
    return;
  }

  const birthText = unknownTime
    ? `${year}년 ${month}월 ${day}일 (태어난 시간 모름)`
    : `${year}년 ${month}월 ${day}일 ${hour}시 ${minute}분`;
  const genderText = gender === 'male' ? '남성' : gender === 'female' ? '여성' : '미상';

  const systemPrompt = `당신은 사주(四柱) 명리학 전문가이자 로또 번호 추천 도우미입니다.
사용자의 생년월일시를 바탕으로 사주를 간단히 분석하고, 그 사주의 오행(五行) 기운과 어울리는 로또 6/45 번호를 추천하세요.
반드시 아래 JSON 형식으로만 응답하고, 그 외의 설명이나 텍스트는 절대 포함하지 마세요.
{"analysis": "3~5문장 분량의 사주 분석 및 번호 추천 이유", "numbers": [서로 다른 1~45 사이 정수 6개], "bonus": "numbers와 겹치지 않는 1~45 사이 정수 1개"}`;

  const userPrompt = `생년월일시: ${birthText}\n성별: ${genderText}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(502).json({ error: `OpenAI API 오류: ${errText}` });
      return;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    let parsed = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (e) {
      parsed = {};
    }

    let numbers = Array.isArray(parsed.numbers)
      ? parsed.numbers.filter(n => Number.isInteger(n) && n >= 1 && n <= 45)
      : [];
    numbers = [...new Set(numbers)].slice(0, 6);

    let bonus = Number.isInteger(parsed.bonus) && parsed.bonus >= 1 && parsed.bonus <= 45
      ? parsed.bonus
      : null;
    if (bonus !== null && numbers.includes(bonus)) bonus = null;

    // 모델 응답이 형식을 어길 경우를 대비한 보정
    const used = new Set(numbers);
    while (numbers.length < 6) {
      const n = Math.floor(Math.random() * 45) + 1;
      if (!used.has(n)) {
        used.add(n);
        numbers.push(n);
      }
    }
    numbers.sort((a, b) => a - b);

    if (bonus === null) {
      let n;
      do {
        n = Math.floor(Math.random() * 45) + 1;
      } while (used.has(n));
      bonus = n;
    }

    const analysis = parsed.analysis || '사주 분석 결과를 불러오지 못했지만, 오행의 균형을 고려해 번호를 추천했습니다.';

    await saveToSupabase({
      birth_year: year,
      birth_month: month,
      birth_day: day,
      birth_hour: unknownTime ? null : hour,
      birth_minute: unknownTime ? null : minute,
      unknown_time: !!unknownTime,
      gender,
      numbers,
      bonus,
      analysis,
    });

    res.status(200).json({ analysis, numbers, bonus });
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했습니다: ' + err.message });
  }
};

// Supabase에 요청/추첨 결과를 기록 (실패해도 사용자 응답은 막지 않음)
async function saveToSupabase(record) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/saju_lotto_requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      console.error('Supabase insert failed:', await res.text());
    }
  } catch (err) {
    console.error('Supabase insert error:', err.message);
  }
}
