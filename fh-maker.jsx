/* fonthead.dev — Screen 3: the maker.
   Drop a sheet, watch the font build (real steps, not a spinner), name it,
   publish or keep private. Simple by default, advanced behind a reveal. */

const { useState:useS3, useEffect:useE3, useRef:useR3 } = React;

const BUILD_STEPS = [
  { k:"binarize", d:"threshold · otsu adaptive",   t:1.1, ms:1100 },
  { k:"slice",    d:"26 cells · baseline locked",  t:0.9, ms:900  },
  { k:"trace",    d:"contours · 1,204 points",     t:1.6, ms:1600 },
  { k:"build",    d:"kern · hint · pack 3 formats",t:1.3, ms:1300 },
];
const TOTAL_MS = BUILD_STEPS.reduce((a,s)=>a+s.ms,0);

function BuildReadout() {
  const reduce = typeof window!=="undefined" && window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [done, setDone] = useS3(reduce ? BUILD_STEPS.length : 0); // # steps completed
  const [run, setRun] = useS3(0); // run id, to restart
  const [prog, setProg] = useS3(reduce ? 100 : 0);
  const barRef = useR3(null);

  useE3(()=>{
    if (reduce) { setDone(BUILD_STEPS.length); setProg(100); return; }
    setDone(0); setProg(0);
    // fill the bar linearly over the whole build
    const raf = requestAnimationFrame(()=>{
      if (barRef.current) {
        barRef.current.style.transition = `width ${TOTAL_MS}ms linear`;
        setProg(100);
      }
    });
    let acc = 0; const timers = [];
    BUILD_STEPS.forEach((s,i)=>{
      acc += s.ms;
      timers.push(setTimeout(()=>setDone(i+1), acc));
    });
    return ()=>{ cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
  }, [run]);

  const finished = done >= BUILD_STEPS.length;

  return (
    React.createElement("div", null,
      // terminal-style honest readout
      React.createElement("div", { style:{ background:"var(--ink)", borderRadius:3,
          padding:"16px 18px", fontFamily:"var(--mono)" } },
        React.createElement("div", { style:{ display:"flex", justifyContent:"space-between",
            alignItems:"center", marginBottom:14 } },
          React.createElement("span", { style:{ fontSize:10.5, letterSpacing:".14em",
            textTransform:"uppercase", color:"rgba(255,255,255,.4)" } }, "build · fonthead maker"),
          React.createElement("span", { style:{ fontSize:11,
            color: finished ? "#6fcf97" : "rgba(255,255,255,.55)" } },
            finished ? "done · 4.9s" : "running")),
        BUILD_STEPS.map((s,i)=>{
          const st = i<done ? "done" : i===done ? "active" : "queued";
          return React.createElement("div", { key:s.k, style:{ display:"flex",
              alignItems:"center", gap:12, padding:"6px 0", fontSize:12.5,
              opacity: st==="queued"?.38:1, transition:"opacity .3s var(--ease)" } },
            React.createElement("span", { style:{ width:13, color:
                st==="done" ? "#6fcf97" : st==="active" ? "var(--signal)" : "rgba(255,255,255,.5)" } },
              st==="done" ? "✓" : st==="active" ? "●" : "·"),
            React.createElement("span", { style:{ width:74, color:"#fff" } }, s.k),
            React.createElement("span", { style:{ flex:1, color:"rgba(255,255,255,.55)" } }, s.d),
            React.createElement("span", { style:{ color: st==="done"?"rgba(255,255,255,.55)":
              st==="active"?"var(--signal)":"rgba(255,255,255,.35)", width:46, textAlign:"right" } },
              st==="done" ? s.t.toFixed(1)+"s" : st==="active" ? "···" : "—"));
        }),
        // progress bar (linear, mechanical)
        React.createElement("div", { style:{ height:2, background:"rgba(255,255,255,.12)",
            marginTop:12, borderRadius:2, overflow:"hidden" } },
          React.createElement("div", { ref:barRef, style:{ height:"100%",
            width: prog+"%", background:"var(--signal)" } }))),

      // result + restart
      React.createElement("div", { style:{ marginTop:16, display:"flex", alignItems:"center",
          justifyContent:"space-between" } },
        React.createElement("div", { style:{ height:64, display:"flex", alignItems:"center" } },
          React.createElement("span", { className:"spec",
            style:{ fontFamily:"'Caveat', cursive", fontSize:56, color:"var(--ink)",
              opacity: finished?1:.25, filter: finished?"none":"blur(2px)",
              transition:"opacity .5s var(--ease), filter .5s var(--ease)" } }, "Handmade")),
        React.createElement("button", { onClick:()=>setRun(r=>r+1), className:"fh-mono",
          style:{ fontSize:11.5, color:"var(--ink-soft)", background:"none",
            border:"1px solid var(--line-2)", borderRadius:2, padding:"7px 12px" } },
          "↺ rebuild")),
    )
  );
}

function AdvancedReveal() {
  const [open, setOpen] = useS3(false);
  const Row = ({label, val})=>React.createElement("div", { style:{ display:"flex",
      alignItems:"center", gap:14, padding:"9px 0" } },
    React.createElement("span", { className:"fh-mono", style:{ fontSize:11,
      width:84, color:"var(--ink-soft)", letterSpacing:".04em" } }, label),
    React.createElement("input", { type:"range", className:"fh-range", defaultValue:val,
      style:{ flex:1 } }),
    React.createElement("span", { className:"fh-mono", style:{ fontSize:11,
      width:34, color:"var(--ink-faint)", textAlign:"right" } }, val));
  return (
    React.createElement("div", { style:{ marginTop:16, borderTop:"1px solid var(--line)" } },
      React.createElement("button", { onClick:()=>setOpen(o=>!o), className:"fh-mono",
        style:{ display:"flex", alignItems:"center", gap:9, width:"100%", padding:"14px 0",
          background:"none", border:"none", fontSize:12, color:"var(--ink-soft)",
          letterSpacing:".02em" } },
        React.createElement("span", { style:{ color:"var(--ink-faint)",
          transition:"transform .3s var(--ease)",
          transform: open?"rotate(45deg)":"none", display:"inline-block" } }, "+"),
        "advanced controls",
        React.createElement("span", { style:{ flex:1 } }),
        React.createElement("span", { style:{ color:"var(--ink-faint)", fontSize:11 } },
          open?"hide":"for the pro")),
      open && React.createElement("div", { style:{ paddingBottom:8 } },
        React.createElement(Row,{label:"spacing",val:48}),
        React.createElement(Row,{label:"contrast",val:62}),
        React.createElement(Row,{label:"slant",val:0}),
        React.createElement(Row,{label:"weight",val:70})),
    )
  );
}

function MakerScreen() {
  const [vis, setVis] = useS3("public");
  const sheet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef".split("");
  return (
    React.createElement("div", { className:"fh", style:{ width:1280, minHeight:1000 } },
      React.createElement(FHNav, { active:"library" }),

      // title + steps
      React.createElement("div", { style:{ display:"flex", alignItems:"flex-end",
          justifyContent:"space-between", padding:"30px 40px 24px",
          borderBottom:"1px solid var(--line)" } },
        React.createElement("div", null,
          React.createElement("h1", { style:{ fontSize:30, fontWeight:600, margin:0,
            letterSpacing:"-.02em" } }, "Make a font"),
          React.createElement("p", { style:{ margin:"8px 0 0", fontSize:14.5,
            color:"var(--ink-soft)" } }, "Drop an alphabet sheet. We build a real, installable font.")),
        React.createElement("div", { className:"fh-mono", style:{ display:"flex", gap:18,
            fontSize:12 } },
          [["01","drop","var(--ink)"],["02","build","var(--signal)"],["03","publish","var(--ink-faint)"]]
            .map(([n,l,c])=>React.createElement("span",{key:n,style:{color:c}},
              React.createElement("b",{style:{fontWeight:700}},n)," ",l)))),

      // workspace
      React.createElement("div", { style:{ display:"grid",
          gridTemplateColumns:"1fr 1fr", gap:0, alignItems:"stretch" } },

        // ---- left: the dropped sheet ----
        React.createElement("div", { style:{ padding:"26px 32px 30px",
            borderRight:"1px solid var(--line)" } },
          React.createElement("div", { style:{ display:"flex", justifyContent:"space-between",
              alignItems:"center", marginBottom:14 } },
            React.createElement("span", { className:"fh-eyebrow" }, "01 · the sheet"),
            React.createElement("span", { className:"fh-mono", style:{ fontSize:11,
              color:"var(--ink-faint)" } }, "alphabet-sheet.png · 26 glyphs detected")),
          React.createElement("div", { style:{ border:"1px solid var(--line-2)",
              borderRadius:3, background:"var(--paper-3)", padding:16,
              display:"grid", gridTemplateColumns:"repeat(8, 1fr)", gap:6 } },
            sheet.map((c,i)=>React.createElement("div", { key:i, style:{ aspectRatio:"1",
                background:"var(--paper)", border:"1px solid var(--line)", borderRadius:2,
                display:"grid", placeItems:"center", position:"relative" } },
              React.createElement("span", { style:{ fontFamily:"'Shadows Into Light', cursive",
                fontSize:30, color:"var(--ink)" } }, c),
              React.createElement("span", { className:"fh-mono", style:{ position:"absolute",
                top:3, left:4, fontSize:7, color:"var(--ink-faint)" } }, (i+1<10?"0":"")+(i+1))))),
          React.createElement("div", { style:{ display:"flex", gap:10, marginTop:14 } },
            React.createElement("button", { className:"fh-btn fh-btn--ghost",
              style:{ flex:1, justifyContent:"center", textAlign:"center" } }, "replace sheet"),
            React.createElement("button", { className:"fh-btn fh-btn--ghost",
              style:{ flex:1, justifyContent:"center" } }, "or generate with ai")),
          React.createElement(AdvancedReveal)),

        // ---- right: build + publish ----
        React.createElement("div", { style:{ padding:"26px 32px 30px",
            background:"var(--paper-2)" } },
          React.createElement("div", { style:{ display:"flex", justifyContent:"space-between",
              alignItems:"center", marginBottom:14 } },
            React.createElement("span", { className:"fh-eyebrow" }, "02 · the build"),
            React.createElement("span", { className:"fh-mono", style:{ fontSize:11,
              color:"var(--ink-faint)" } }, "honest readout · no spinner")),
          React.createElement(BuildReadout),

          // publish
          React.createElement("div", { style:{ marginTop:24, paddingTop:22,
              borderTop:"1px solid var(--line)" } },
            React.createElement("span", { className:"fh-eyebrow", style:{ display:"block",
              marginBottom:14 } }, "03 · publish"),
            React.createElement("label", { className:"fh-mono", style:{ fontSize:11,
              color:"var(--ink-faint)", letterSpacing:".06em", display:"block",
              marginBottom:7 } }, "NAME"),
            React.createElement("input", { defaultValue:"Handmade", className:"fh-input",
              style:{ width:"100%" } }),
            React.createElement("div", { style:{ display:"flex", gap:18, marginTop:18,
                alignItems:"center" } },
              React.createElement("div", { style:{ display:"flex", border:"1px solid var(--line-2)",
                  borderRadius:2, overflow:"hidden" } },
                ["public","private"].map(v=>React.createElement("button", { key:v,
                  onClick:()=>setVis(v), className:"fh-mono",
                  style:{ fontSize:12, padding:"9px 16px", border:"none",
                    background: vis===v?"var(--ink)":"var(--paper)",
                    color: vis===v?"var(--paper)":"var(--ink-soft)",
                    transition:"all var(--dur) var(--ease)" } }, v))),
              React.createElement("span", { className:"fh-mono", style:{ fontSize:11,
                color:"var(--ink-faint)", flex:1 } },
                vis==="public" ? "appears on the library wall" : "only you can see it"),
              React.createElement("button", { className:"fh-btn",
                style:{ padding:"11px 22px" } }, "publish  →")),
          )),
      ),

      React.createElement("footer", { style:{ padding:"20px 40px",
          borderTop:"1px solid var(--line)", display:"flex", justifyContent:"space-between" } },
        React.createElement("div", { className:"fh-mono", style:{ fontSize:11,
          color:"var(--ink-faint)" } }, "exports otf · ttf · woff2 · color + single-line supported"),
        React.createElement("div", { className:"fh-mono", style:{ fontSize:11,
          color:"var(--ink-faint)" } }, "your font · your license")),
    )
  );
}

Object.assign(window, { MakerScreen, BuildReadout });
