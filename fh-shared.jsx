/* fonthead.dev — shared UI: nav, favorite, upvote, badge, specimen card.
   Every interaction uses the single mechanical easing. No bounce. */

const { useState } = React;

function FHNav({ active, onMake }) {
  return (
    React.createElement("nav", { className:"fh-nav" },
      React.createElement("div", { className:"fh-wordmark" }, "fonthead",
        React.createElement("span", { className:"dot" }, ".dev")),
      React.createElement("div", { style:{ width:1, height:22, background:"var(--line)", margin:"0 4px" } }),
      ["library","makers","about"].map(l =>
        React.createElement("a", { key:l, href:"#", className:"fh-navlink",
          style:{ color: l===active ? "var(--ink)" : undefined,
                  fontWeight: l===active ? 600 : 400 } }, l)),
      React.createElement("div", { style:{ flex:1 } }),
      React.createElement("label", { className:"fh-search" },
        React.createElement("svg", { width:13, height:13, viewBox:"0 0 14 14", fill:"none",
          stroke:"currentColor", strokeWidth:1.5 },
          React.createElement("circle",{cx:6,cy:6,r:4.2}),
          React.createElement("path",{d:"M9.2 9.2L12.5 12.5",strokeLinecap:"round"})),
        React.createElement("span", null, "search 1,840 fonts")),
      React.createElement("button", { className:"fh-btn", onClick:onMake }, "make a font  →"),
      React.createElement("div", { className:"fh-avatar", title:"signed in" }, "rm"),
    )
  );
}

function FavBtn({ on:on0, big }) {
  const [on, setOn] = useState(!!on0);
  return React.createElement("button", {
    className:"fh-fav" + (on?" on":""),
    style: big ? { width:38, height:38 } : null,
    "aria-pressed": on, title:"favorite",
    onClick:(e)=>{ e.stopPropagation(); e.preventDefault(); setOn(v=>!v); },
  }, React.createElement(Heart, { size: big?17:14 }));
}

function VoteBtn({ count:c0, on:on0 }) {
  const [on, setOn] = useState(!!on0);
  const [c, setC] = useState(c0);
  const [bump, setBump] = useState(false);
  const toggle = (e)=>{
    e.stopPropagation(); e.preventDefault();
    setOn(v=>{ const nv=!v; setC(c0 + (nv?1:0)); return nv; });
    setBump(true); setTimeout(()=>setBump(false), 230);
  };
  return React.createElement("button", { className:"fh-vote"+(on?" on":""), onClick:toggle },
    React.createElement("span", { className:"caret" }, React.createElement(Caret)),
    React.createElement("span", { className:"fh-count",
      style:{ transform: bump?"translateY(-2px)":"translateY(0)" } },
      c.toLocaleString()));
}

function Badge({ kind, vis }) {
  if (vis === "private")
    return React.createElement("span", { className:"fh-badge fh-badge--private" },
      React.createElement("span",{className:"tick"}), "private");
  if (!kind) return null;
  const label = kind==="color" ? "color" : kind==="line" ? "single-line" : "variable";
  return React.createElement("span", { className:"fh-badge fh-badge--"+kind },
    React.createElement("span",{className:"tick"}), label);
}

// the specimen card on the library wall.
// loud specimen up top, quiet name·maker, then a hairline + ambient
// mono readout row (glyph count · formats) with vote + favorite.
function FontCard({ f, onOpen }) {
  return React.createElement("article", {
      className:"fh-card", onClick:(e)=>onOpen&&onOpen(f, e.currentTarget),
      style:{ cursor:"pointer", display:"flex", flexDirection:"column" } },
    // specimen panel
    React.createElement("div", { style:{ position:"relative", height:200, padding:"0 26px",
        display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden",
        borderBottom:"1px solid var(--line)", background:"var(--paper)" } },
      (f.badge || f.vis==="private") && React.createElement("div", {
          style:{ position:"absolute", top:14, right:14, display:"flex", gap:6 } },
        f.vis==="private" && React.createElement(Badge,{vis:"private"}),
        f.badge && React.createElement(Badge,{kind:f.badge})),
      React.createElement("div", {
        className: specClass(f),
        style:{ ...specStyle(f), fontSize: Math.min(f.size,92),
          maxWidth:"100%", whiteSpace:"nowrap" } }, f.word)),
    // name + maker
    React.createElement("div", { style:{ padding:"15px 18px 0", display:"flex",
        alignItems:"baseline", justifyContent:"space-between", gap:10 } },
      React.createElement("div", null,
        React.createElement("div", { style:{ fontSize:15.5, fontWeight:600,
          letterSpacing:"-.01em" } }, f.name),
        React.createElement("div", { className:"fh-mono", style:{ fontSize:11.5,
          color:"var(--ink-faint)", marginTop:3 } }, "by ", f.maker)),
      React.createElement(FavBtn, { on:f.fav })),
    // ambient technical readout
    React.createElement("div", { style:{ padding:"13px 18px 14px", marginTop:13,
        borderTop:"1px solid var(--line)", display:"flex", alignItems:"center",
        justifyContent:"space-between" } },
      React.createElement("div", { className:"fh-mono", style:{ fontSize:10.5,
        color:"var(--ink-faint)", letterSpacing:".02em" } },
        f.glyphs+" glyphs · otf ttf woff2"),
      React.createElement(VoteBtn, { count:f.votes, on:f.fav })),
  );
}

Object.assign(window, { FHNav, FavBtn, VoteBtn, Badge, FontCard });
