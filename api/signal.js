// api/signal.js
import yahooFinance from 'yahoo-finance2';

const TICKER      = 'BTC-USD';
const INTERVAL    = '5m';
const DAYS_BACK   = 60;
const SEC_PER_DAY = 24 * 60 * 60;

// Calcula SMA de ventana n sobre array
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
    // 1) Definir rango UNIX
    const now     = Math.floor(Date.now() / 1000);
    const period2 = now;
    const period1 = now - DAYS_BACK * SEC_PER_DAY;

    // 2) Llamar a chart()
    const data = await yahooFinance.chart(TICKER, {
      period1,
      period2,
      interval: INTERVAL
    });

    // 3) Verificar que hay resultado
    if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
      console.error('No chart.result:', JSON.stringify(data));
      throw new Error('No hay datos de gráfico');
    }

    const result = data.chart.result[0];

    // 4) Verificar que existen cierres
    const quote = result.indicators?.quote?.[0];
    if (!quote || !Array.isArray(quote.close) || quote.close.length === 0) {
      console.error('No quote.close:', JSON.stringify(result));
      throw new Error('No hay datos de precios');
    }

    // 5) Filtrar valores null y quedarse solo con números
    const closes = quote.close.filter(c => c != null);

    // 6) Buscar SMA óptima
    let best = { ret: -Infinity, short: 0, long: 0, n: 0 };
    const shorts = [5,10,15,20,25,30];
    const longs  = [35,40,45,50,55,60,65,70,75,80,85,90,95,100,105,110,115,120];

    for (let s of shorts) {
      for (let l of longs) {
        if (s >= l) continue;
        const smaS = sma(closes, s);
        const smaL = sma(closes, l);
        let pos=0, ret=1, cnt=0;
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

    // 7) Señal de la última vela
    const idx = closes.length - 1;
    const smaS = sma(closes, best.short);
    const smaL = sma(closes, best.long);
    const lastSignal = (smaS[idx-1] < smaL[idx-1] && smaS[idx] > smaL[idx]) ? 'Comprar'
                     : (smaS[idx-1] > smaL[idx-1] && smaS[idx] < smaL[idx]) ? 'Vender'
                     : 'Mantener';

    // 8) Devolver JSON
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
