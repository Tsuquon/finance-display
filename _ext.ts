import YFDefault from "yahoo-finance2";
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical"] });
(async () => {
  const p1 = new Date(); p1.setDate(p1.getDate() - 10);
  const r = await yf.chart("MSFT", { period1: p1, interval: "30m", includePrePost: true });
  const qs = (r.quotes||[]).filter((q:any)=>q.open!=null&&q.high!=null&&q.low!=null&&q.close!=null);
  // group by UTC day, print last 2 days fully
  const byDay = new Map<string, any[]>();
  for (const q of qs) {
    const d = new Date(q.date).toISOString().slice(0,10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(q);
  }
  const days = [...byDay.keys()].sort();
  for (const day of days.slice(-2)) {
    console.log("\n=== "+day+" ===  (regular session 13:30-20:00 UTC in summer EDT)");
    for (const q of byDay.get(day)!) {
      const t = new Date(q.date);
      const hh = String(t.getUTCHours()).padStart(2,'0'), mm = String(t.getUTCMinutes()).padStart(2,'0');
      const range = q.high-q.low;
      console.log(`  ${hh}:${mm}Z  O${q.open.toFixed(2)} H${q.high.toFixed(2)} L${q.low.toFixed(2)} C${q.close.toFixed(2)} V${(q.volume||0)} range=${range.toFixed(2)}`);
    }
  }
})();
