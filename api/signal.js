// api/signal.js
const TICKER   = 'BTC-USD';
const RANGE    = '1mo';  // Último mes; admite '1mo','7d','5d','1d',...
const INTERVAL = '5m';   // Velas de 5 minutos

// Calcula la SMA de ventana n sobre array de precios
function sma(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const slice = arr.slice(Math.max(0, i - n + 1), i + 1);
    const sum   = slice.reduce((s, v) => s + v, 0);
    out.push(sum / slice.length);
  }
  return out;
}

export default async function handler(req, res) {
  try {
    // 1) Llamada directa al API público de Yahoo
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${TICKER}` +
                `?range=${RANGE}&interval=${INTERVAL}`;
    const r   = await fetch(url);
    if (!r.ok) throw new Error(`Yahoo API responded ${r.status}`);
    const j   = await r.json();

    // 2) Validaciones básicas
    const result = j.chart?.result?.[0];
    if (!result) throw new Error('No hay data.chart.result');
    const closesAll = result.indicators?.quote?.[0]?.close;
    if (!Array.isArray(closesAll)) throw new Error('No hay quote.close');

    // 3) Filtrar nulos
    const closes = closesAll.filter(c => c != null);
    if (closes.length < 10) throw new Error('Datos insuficientes');

    // 4) Backtest para encontrar cruce SMA óptimo
    let best = { ret: -Infinity, short: 0, long: 0, n: 0 };
    const shorts = [5,10,15,20,25,30];
    const longs  = [35,40,45,50,55,60,65,70,75,80,85,90,95,100,105,110,115,120];

    for (let s of shorts) {
      for (let l of longs) {
        if (s >= l) continue;
        const smaS = sma(closes, s);
        const smaL = sma(closes, l);
        let pos = 0, ret = 1, cnt = 0;
        for (let i = 1; i < closes.length; i++) {
          const signal = (smaS[i-1] < smaL[i-1] && smaS[i] > smaL[i]) ? 1
                       : (smaS[i-1] > smaL[i-1] && smaS[i] < smaL[i]) ? -1
                       : 0;
          if (signal !== 0) { pos = signal; cnt++; }
          ret *= 1 + pos * ((closes[i] - closes[i-1]) / closes[i-1]);
        }
        if (ret - 1 > best.ret) best = { ret: ret - 1, short: s, long: l, n: cnt };
      }
    }

    // 5) Señal de la última vela
    const idx   = closes.length - 1;
    const smaS  = sma(closes, best.short);
    const smaL  = sma(closes, best.long);
    const lastSignal = (smaS[idx-1] < smaL[idx-1] && smaS[idx] > smaL[idx]) ? 'Comprar'
                     : (smaS[idx-1] > smaL[idx-1] && smaS[idx] < smaL[idx]) ? 'Vender'
                     : 'Mantener';

    // 6) Envío de JSON
    return res.status(200).json({
      signal: lastSignal,
      short:  best.short,
      long:   best.long,
      ret:    (best.ret * 100).toFixed(2),
      n:      best.n
    });
  } catch (e) {
    console.error('API /api/signal error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
