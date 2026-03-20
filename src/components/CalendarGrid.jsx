// CalendarGrid.jsx — calendar grid component
import { dateToLocal } from "../utils.js";

export function CalendarGrid({ days, activeRes, colorMap, todayStr, cellHeight=110, fontSize=11, previewId="", lessonIds=null }) {
  // Split days into weeks of 7
  const weeks = [];
  for(let i=0;i<days.length;i+=7) weeks.push(days.slice(i,i+7));

  // For each week, compute event bars with slot assignment (no overlaps)
  const getWeekBars = (week) => {
    const weekStart = week.find(d=>d);
    const weekEnd   = [...week].reverse().find(d=>d);
    if(!weekStart||!weekEnd) return [];
    const wsStr = dateToLocal(weekStart);
    const weStr = dateToLocal(weekEnd);

    // events overlapping this week, sorted by borrow_date then by id (insertion order)
    const evts = activeRes
      .filter(r => r.borrow_date<=weStr && r.return_date>=wsStr)
      .sort((a,b) => a.borrow_date<b.borrow_date?-1:a.borrow_date>b.borrow_date?1:Number(a.id)-Number(b.id));

    // slot assignment: each slot tracks the last ec used
    // A bar can go into slot S only if slotEnd[S] < sc (columns don't overlap)
    const slotEnd = []; // slotEnd[s] = last ec used in slot s
    const bars = [];
    evts.forEach(r=>{
      const [bg,color] = colorMap[r.id]||["rgba(52,152,219,0.38)","#5dade2"];
      const startCol = week.findIndex(d=>d && dateToLocal(d)>=r.borrow_date);
      const endColRaw= week.findLastIndex(d=>d && dateToLocal(d)<=r.return_date);
      const sc = startCol<0?0:startCol;
      const ec = endColRaw<0?6:endColRaw;
      // find lowest slot where this bar fits (no column overlap)
      let slot=0;
      while(slotEnd[slot]!==undefined && slotEnd[slot]>=sc) slot++;
      slotEnd[slot]=ec;
      bars.push({r,bg,color,sc,ec,slot,showName: week[sc]&&dateToLocal(week[sc])>=r.borrow_date});
    });
    return bars;
  };

  const DAY_NUM_H = 22;
  const EVENT_H   = fontSize+8;
  const EVENT_GAP = 2;

  return (
    <div style={{direction:"rtl"}}>
      {weeks.map((week,wi)=>{
        const bars = getWeekBars(week);
        const maxSlot = bars.length?Math.max(...bars.map(b=>b.slot)):0;
        const rowH = Math.max(cellHeight, DAY_NUM_H + (maxSlot+1)*(EVENT_H+EVENT_GAP)+8);
        return (
          <div key={wi} style={{position:"relative",height:rowH,marginBottom:4}}>
            {/* Background cells */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,height:"100%",position:"absolute",inset:0}}>
              {week.map((d,di)=>{
                const isToday=d&&dateToLocal(d)===todayStr;
                return (
                  <div key={di} style={{
                    background:"var(--surface2)",borderRadius:6,
                    border:`1px solid ${isToday?"var(--accent)":"var(--border)"}`,
                    padding:"5px 6px",overflow:"hidden",
                    opacity:!d?0.2:1,
                  }}>
                    {d&&<div style={{fontSize:13,fontWeight:isToday?900:700,color:isToday?"var(--accent)":"var(--text2)"}}>{d.getDate()}</div>}
                  </div>
                );
              })}
            </div>
            {/* Event overlay bars */}
            {bars.map((b,bi)=>{
              const colW = 100/7;
              const right = `calc(${b.sc*colW}% + 2px)`;
              const width = `calc(${(b.ec-b.sc+1)*colW}% - 4px)`;
              const top   = DAY_NUM_H + b.slot*(EVENT_H+EVENT_GAP);
              const isResStart = week[b.sc]&&dateToLocal(week[b.sc])===b.r.borrow_date;
              const isResEnd   = week[b.ec]&&dateToLocal(week[b.ec])===b.r.return_date;
              return (
                <div key={bi} style={{
                  position:"absolute",
                  right, top, width, height:EVENT_H,
                  background:b.bg,
                  borderRadius: isResStart&&isResEnd?"4px": isResStart?"0 4px 4px 0": isResEnd?"4px 0 0 4px":"0",
                  display:"flex",alignItems:"center",justifyContent:"flex-end",
                  paddingLeft:isResStart?8:2, paddingRight:isResEnd?6:2,
                  overflow:"hidden",whiteSpace:"nowrap",
                  fontSize, color:b.color, fontWeight:700,
                  zIndex:previewId&&b.r.id===previewId?0:1,
                  outline:previewId&&b.r.id===previewId?"2px dashed rgba(245,166,35,0.7)":
                    (lessonIds&&lessonIds.has(b.r.id))||b.r.loan_type==="שיעור"?"2px dashed rgba(155,89,182,0.8)":"none",
                  outlineOffset:"-2px",
                }}>
                  {isResStart && <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{b.r.student_name}{b.r.borrow_time&&<span style={{opacity:0.8,fontSize:fontSize-1}}> {b.r.borrow_time}</span>}</span>}
                  {!isResStart && isResEnd && <span style={{fontWeight:700,overflow:"hidden",textOverflow:"ellipsis"}}>↩ {b.r.student_name}{b.r.return_time&&<span style={{opacity:0.8,fontSize:fontSize-1}}> {b.r.return_time}</span>}</span>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
