/* fonthead.dev — Screen 1: the library (home / browse).
   You land in the work: a wall of fonts the community made.
   Hero = the same word, cycling through faces, the only color in the room. */

const { useState:useS1, useEffect:useE1, useRef:useR1 } = React;

function CyclingWordmark() {
  const faces = FH_HERO_FACES;
  const [i, setI] = useS1(0);
  const [show, setShow] = useS1(true);
  const reduce = typeof window!=="undefined" &&
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useE1(()=>{
    if (reduce) return;
    let idx = 0;
    const t = setInterval(()=>{
      setShow(false);
      setTimeout(()=>{ idx=(idx+1)%faces.length; setI(idx); setShow(true); }, 170);
    }, 2600);
    return ()=>clearInterval(t);
  }, []);

  const f = faces[i];
  return (
    React.createElement("div", { style:{ textAlign:"center" } },
      React.createElement("div", {
        style:{ height:210, display:"flex", alignItems:"center", justifyContent:"center" } },
        React.createElement("div", {
          className: specClass(f),
          style:{ ...specStyle(f), fontSize:148, lineHeight:.9, whiteSpace:"nowrap",
            opacity: show?1:0, transition:"opacity .17s var(--ease)" } }, "fonthead")),
      React.createElement("div", { className:"fh-mono",
        style:{ marginTop:8, fontSize:12, color:"var(--ink-faint)", letterSpacing:".02em",
          display:"flex", gap:14, justifyContent:"center", alignItems:"center",
          height:18 } },
        React.createElement("span", null, "one word · every face the community made"),
        React.createElement("span", { style:{ color:"var(--line-3)" } }, "—"),
        React.createElement("span", { style:{ color:"var(--ink-soft)",
          opacity: show?1:0, transition:"opacity .17s var(--ease)" } },
          f.label, " · by ", f.maker)),
    )
  );
}

// "the card becomes the page" — FLIP morph from a card's rect to the full
// font page, with the one mechanical easing. Lives inside the library frame.
function CardMorph({ font, rootRef, onClose }) {
  const [rect, setRect] = useS1(font.__rect);
  const [open, setOpen] = useS1(false);
  useE1(()=>{
    const h = rootRef.current ? rootRef.current.offsetHeight : 2080;
    const r = requestAnimationFrame(()=>{ setRect({ left:0, top:0, width:1280, height:h }); setOpen(true); });
    return ()=>cancelAnimationFrame(r);
  }, []);
  const close = ()=>{
    setOpen(false); setRect(font.__rect);
    setTimeout(onClose, 480);
  };
  return React.createElement("div", { onClick:close, style:{ position:"absolute", inset:0,
      zIndex:60, background: open?"rgba(20,18,12,.18)":"rgba(20,18,12,0)",
      transition:"background .5s var(--ease)" } },
    React.createElement("div", { onClick:(e)=>e.stopPropagation(), style:{ position:"absolute",
        left:rect.left, top:rect.top, width:rect.width, height:rect.height,
        background:"var(--paper)", overflow:"hidden", borderRadius: open?0:2,
        boxShadow:"0 30px 90px -30px rgba(20,18,12,.5)",
        border:"1px solid var(--line)",
        transition:"left .5s var(--ease), top .5s var(--ease), width .5s var(--ease), height .5s var(--ease), border-radius .5s var(--ease)" } },
      React.createElement("button", { onClick:close, className:"fh-mono", style:{ position:"absolute",
        top:18, right:20, zIndex:5, width:32, height:32, border:"1px solid var(--line-2)",
        borderRadius:2, background:"var(--paper)", color:"var(--ink-soft)", fontSize:15 } }, "×"),
      React.createElement("div", { style:{ width:1280, opacity: open?1:0,
          transition:"opacity .4s var(--ease) .12s" } },
        React.createElement(FontPageScreen, { font }))));
}

function LibraryScreen() {
  const [sort, setSort] = useS1("popular");
  const [openFont, setOpenFont] = useS1(null);
  const rootRef = useR1(null);
  const fonts = [...FH_FONTS].sort((a,b)=>
    sort==="popular" ? b.votes-a.votes
      : FH_FONTS.indexOf(a)-FH_FONTS.indexOf(b)); // "new" keeps authored order
  const newOrder = sort==="new"
    ? [...FH_FONTS].reverse() : fonts;
  const list = sort==="popular" ? fonts : newOrder;

  const openFromCard = (f, cardEl)=>{
    const root = rootRef.current; if (!root) return;
    const rr = root.getBoundingClientRect();
    const scale = rr.width / 1280 || 1;
    const cr = cardEl.getBoundingClientRect();
    setOpenFont({ ...f, __rect:{ left:(cr.left-rr.left)/scale, top:(cr.top-rr.top)/scale,
      width:cr.width/scale, height:cr.height/scale } });
  };

  return (
    React.createElement("div", { className:"fh", ref:rootRef,
        style:{ width:1280, minHeight:2080, position:"relative" } },
      React.createElement(FHNav, { active:"library" }),

      // ---- hero / daily feature ----
      React.createElement("header", { style:{ padding:"56px 40px 30px",
          borderBottom:"1px solid var(--line)", position:"relative" } },
        React.createElement("div", { className:"fh-eyebrow",
          style:{ position:"absolute", top:24, left:40 } }, "fonthead.dev"),
        React.createElement("div", { className:"fh-eyebrow",
          style:{ position:"absolute", top:24, right:40, color:"var(--ink-soft)" } },
          "featuring · yesterday's most-liked"),
        React.createElement(CyclingWordmark),
        React.createElement("p", { style:{ textAlign:"center", maxWidth:540, margin:"22px auto 0",
          fontSize:15.5, lineHeight:1.5, color:"var(--ink-soft)" } },
          "Make a font from an alphabet sheet, then publish it here. ",
          "Every specimen below is real type someone built and shared.")),

      // ---- sort bar ----
      React.createElement("div", { style:{ display:"flex", alignItems:"center",
          justifyContent:"space-between", padding:"20px 40px",
          borderBottom:"1px solid var(--line)", position:"sticky", top:0 } },
        React.createElement("div", { style:{ display:"flex", gap:4 } },
          ["popular","new"].map(s =>
            React.createElement("button", { key:s, onClick:()=>setSort(s),
              className:"fh-mono",
              style:{ fontSize:12.5, letterSpacing:".02em", padding:"7px 14px",
                border:"1px solid "+(sort===s?"var(--ink)":"var(--line-2)"),
                background: sort===s?"var(--ink)":"var(--paper)",
                color: sort===s?"var(--paper)":"var(--ink-soft)", borderRadius:2,
                transition:"all var(--dur) var(--ease)" } }, s))),
        React.createElement("div", { className:"fh-mono", style:{ fontSize:11.5,
          color:"var(--ink-faint)" } },
          "1,840 fonts · ", React.createElement("span",{style:{color:"var(--ink-soft)"}},"12 shown"))),

      // ---- the wall ----
      React.createElement("div", { style:{ padding:"28px 40px 0",
          display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:20 } },
        list.map(f => React.createElement(FontCard, { key:f.id, f,
          onOpen:(ff, el)=> openFromCard(ff, el) }))),

      // ---- footer ----
      React.createElement("footer", { style:{ marginTop:40, padding:"26px 40px",
          borderTop:"1px solid var(--line)", display:"flex", alignItems:"center",
          justifyContent:"space-between" } },
        React.createElement("div", { className:"fh-mono", style:{ fontSize:11,
          color:"var(--ink-faint)", letterSpacing:".04em" } },
          "fonthead.dev · free · otf ttf woff2 · color + single-line + variable"),
        React.createElement("div", { className:"fh-mono", style:{ fontSize:11,
          color:"var(--ink-faint)" } }, "made, not generated")),

      openFont && React.createElement(CardMorph, { font:openFont, rootRef,
        onClose:()=>setOpenFont(null) }),
    )
  );
}

Object.assign(window, { LibraryScreen, CyclingWordmark });
