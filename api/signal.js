// api/signal.js
const TICKER = 'BTC-USD';
const RANGE = '1mo'; // Último mes
const INTERVAL = '15m'; // Velas de 15 minutos

// Calcula la SMA de ventana n sobre array de precios
function sma(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const slice = arr.slice(Math.max(0, i - n + 1), i + 1);
    const sum = slice.reduce((s, v) => s + v, 0);
    out.push(sum / slice.length);
  }
  return out;
}

export default async function handler(req, res) {
  try {
    // 1) Llamada directa al API público (fetch global)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${TICKER}` +
      `?range=${RANGE}&interval=${INTERVAL}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Yahoo API responded ${r.status}`);
    const j = await r.json();

    // 2) Validar estructura
    const result = j.chart?.result?.[0];
    const closesAll = result?.indicators?.quote?.[0]?.close;
    const timestampsAll = result?.timestamp;

    if (!result || !Array.isArray(closesAll) || !Array.isArray(timestampsAll)) {
      throw new Error('Respuesta con formato inesperado');
    }

    // 3) Emparejar timestamps y cierres, filtrar nulos
    const dataArr = timestampsAll
      .map((ts, i) => ({ ts, close: closesAll[i] }))
      .filter(d => d.close != null);

    if (dataArr.length < 10) throw new Error('Datos insuficientes');

    const closes = dataArr.map(d => d.close);
    const timestamps = dataArr.map(d => d.ts); // en segundos

    // 4) Backtest para encontrar el mejor cruce SMA
    let best = { ret: -Infinity, short: 0, long: 0, n: 0 };
    const shorts = [5, 10, 15, 20, 25, 30];
    const longs = [35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120];

    for (let s of shorts) {
      for (let l of longs) {
        if (s >= l) continue;

        const smaS = sma(closes, s);
        const smaL = sma(closes, l);

        let pos = 0, ret = 1, cnt = 0;
        for (let i = 1; i < closes.length; i++) {
          const signal = (smaS[i - 1] < smaL[i - 1] && smaS[i] > smaL[i]) ? 1 :
            (smaS[i - 1] > smaL[i - 1] && smaS[i] < smaL[i]) ? -1 : 0;

          if (signal !== 0) {
            pos = signal;
            cnt++;
          }
          ret *= 1 + pos * ((closes[i] - closes[i - 1]) / closes[i - 1]);
        }

        if (ret - 1 > best.ret) {
          best = { ret: ret - 1, short: s, long: l, n: cnt };
        }
      }
    }

    // 5) Generar señales con el cruce óptimo
    const smaS_opt = sma(closes, best.short);
    const smaL_opt = sma(closes, best.long);

    const signalsArr = closes.map((_, i) => {
      if (i === 0) return 0;
      if (smaS_opt[i - 1] < smaL_opt[i - 1] && smaS_opt[i] > smaL_opt[i]) return 1;
      if (smaS_opt[i - 1] > smaL_opt[i - 1] && smaS_opt[i] < smaL_opt[i]) return -1;
      return 0;
    });

    // Señal actual (última vela)
    const currSig = signalsArr[signalsArr.length - 1];
    const currentSignal = currSig === 1 ? 'Buy' : currSig === -1 ? 'Sell' : 'Hold';

    // 6) Última señal efectiva
    const effIdxs = signalsArr.map((v, i) => v !== 0 ? i : null).filter(i => i != null);
    const lastEffIdx = effIdxs[effIdxs.length - 1];
    const lastSignalType = signalsArr[lastEffIdx] === 1 ? 'Buy' : 'Sell';
    const tsLastSignal = timestamps[lastEffIdx] * 1000; // ms
    const priceAtSignal = closes[lastEffIdx];
    const priceNow = closes[closes.length - 1];
    const variation = parseFloat(((priceNow / priceAtSignal - 1) * 100).toFixed(2));

    // 7) Devolver JSON con todo
    return res.status(200).json({
      signal: currentSignal,
      short: best.short,
      long: best.long,
      ret: parseFloat((best.ret * 100).toFixed(2)),
      n: best.n,
      lastSignalTimestamp: tsLastSignal,
      lastSignalType: lastSignalType,
      variation: variation
    });
  } catch (e) {
    console.error('API /api/signal error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
