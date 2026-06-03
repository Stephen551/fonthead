/* fonthead.dev — Screen 2: a font's page.
   One font, large, as a specimen you can type into. Metadata sits as
   quiet technical texture. Download OTF/TTF/WOFF2. */

const { useState:useS2, useRef:useR2 } = React;

function DlBtn({ fmt, size }) {
  return React.createElement("button", { className:"fh-dl" },
    React.createElement("span", { className:"fh-mono fmt" }, fmt),
    React.createElement("span", { className:"fh-mono sz" }, size),
    React.createElement("svg", { width:13, height:13, viewBox:"0 0 14 14", fill:"none",
      stroke:"currentColor", strokeWidth:1.5, strokeLinecap:"round" },
      React.createElement("path",{d:"M7 1.5v8M3.5 6L7 9.5L10.5 6M2 12.5h10"})));
}

function MetaRow({ k, v, mono=true }) {
  return React.createElement("div", { style:{ display:"flex", justifyContent:"space-between",
      padding:"10px 0", borderBottom:"1px solid var(--line)", gap:16 } },
    React.createElement("span", { className:"fh-mono", style:{ fontSize:11.5,
      color:"var(--ink-faint)", letterSpacing:".04em" } }, k),
    React.createElement("span", { className: mono?"fh-mono":"",
      style:{ fontSize:12.5, color:"var(--ink)", textAlign:"right" } }, v));
}

function FontPageScreen({ font }) {
  const f = font || FH_FONTS.find(x=>x.id==="ember-flux");
  const [size, setSize] = useS2(132);
  const ref = useR2(null);

  const glyphRow = (s) => s.split("").map((c,idx)=>
    React.createElement("div", { key:idx, style:{ aspectRatio:"1", display:"grid",
      placeItems:"center", border:"1px solid var(--line)", borderRadius:2,
      background:"var(--paper)" } },
      React.createElement("span", { className: specClass(f),
        style:{ ...specStyle(f), fontSize:30, lineHeight:1 } }, c)));

  return (
    React.createElement("div", { className:"fh", style:{ width:1280, minHeight:1200 } },
      React.createElement(FHNav, { active:"library" }),

      // back + title row
      React.createElement("div", { style:{ display:"flex", alignItems:"center",
          justifyContent:"space-between", padding:"18px 40px",
          borderBottom:"1px solid var(--line)" } },
        React.createElement("a", { href:"#", className:"fh-mono",
          style:{ fontSize:12.5, color:"var(--ink-soft)", textDecoration:"none",
            display:"inline-flex", gap:8, alignItems:"center" } },
          React.createElement("span",null,"←"), "library / ", f.name.toLowerCase().replace(/ /g,"-")),
        React.createElement("div", { style:{ display:"flex", gap:9, alignItems:"center" } },
          f.badge && React.createElement(Badge,{kind:f.badge}),
          React.createElement(Badge,{vis:f.vis==="private"?"private":null}),
          React.createElement("span", { className:"fh-mono", style:{ fontSize:11,
            color:"var(--ink-faint)" } }, "published 05·31·2026"))),

      // ---- type-into specimen ----
      React.createElement("section", { style:{ padding:"34px 40px 24px",
          borderBottom:"1px solid var(--line)" } },
        React.createElement("div", { style:{ display:"flex", justifyContent:"space-between",
            alignItems:"baseline", marginBottom:18 } },
          React.createElement("div", null,
            React.createElement("h1", { style:{ fontSize:26, fontWeight:600, margin:0,
              letterSpacing:"-.02em" } }, f.name),
            React.createElement("div", { className:"fh-mono", style:{ fontSize:12,
              color:"var(--ink-soft)", marginTop:6 } }, "by ", f.maker,
              f.badge==="color" && React.createElement("span",{style:{color:"var(--ink-faint)"}},
                "  ·  color font · renders its own gradient"))),
          React.createElement("div", { style:{ display:"flex", gap:10, alignItems:"center" } },
            React.createElement(FavBtn, { on:f.fav, big:true }),
            React.createElement(VoteBtn, { count:f.votes, on:f.fav }))),

        // editable specimen
        React.createElement("div", { className:"fh-type", style:{ position:"relative",
            minHeight: size*1.15, display:"flex", alignItems:"center", overflow:"hidden",
            padding:"6px 0" } },
          React.createElement("div", {
            ref, contentEditable:true, suppressContentEditableWarning:true,
            spellCheck:false, className: specClass(f),
            style:{ ...specStyle(f), fontSize:size, lineHeight:1.06, outline:"none",
              width:"100%", whiteSpace:"nowrap", caretColor:"var(--signal)" } },
            "Type something")),

        // size control + hint
        React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:20,
            marginTop:18 } },
          React.createElement("span", { className:"fh-mono", style:{ fontSize:11,
            color:"var(--ink-faint)", letterSpacing:".06em" } }, "SIZE"),
          React.createElement("input", { type:"range", min:48, max:220, value:size,
            onChange:(e)=>setSize(+e.target.value), className:"fh-range",
            style:{ flex:1, maxWidth:420 } }),
          React.createElement("span", { className:"fh-mono", style:{ fontSize:12,
            color:"var(--ink-soft)", width:54 } }, size+" px"),
          React.createElement("span", { style:{ flex:1 } }),
          React.createElement("span", { className:"fh-mono", style:{ fontSize:11,
            color:"var(--ink-faint)" } }, "click the specimen to type")),
      ),

      // ---- lower: glyph set + metadata ----
      React.createElement("div", { style:{ display:"grid",
          gridTemplateColumns:"1fr 380px", gap:0, alignItems:"stretch" } },
        // glyph set
        React.createElement("div", { style:{ padding:"28px 40px",
            borderRight:"1px solid var(--line)" } },
          React.createElement("div", { className:"fh-eyebrow", style:{ marginBottom:18 } },
            "Glyph set · ", f.glyphs, " total"),
          React.createElement("div", { style:{ display:"grid",
              gridTemplateColumns:"repeat(13, 1fr)", gap:8 } },
            glyphRow("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
            glyphRow("abcdefghijklmnopqrstuvwxyz"),
            glyphRow("0123456789&?!@#.,…—()$"))),

        // metadata panel
        React.createElement("aside", { style:{ padding:"28px 32px",
            background:"var(--paper-2)" } },
          React.createElement("div", { className:"fh-eyebrow", style:{ marginBottom:8 } },
            "Files"),
          React.createElement("div", { style:{ display:"flex", flexDirection:"column",
              gap:8, marginBottom:24 } },
            React.createElement(DlBtn,{fmt:"OTF",size:f.otf}),
            React.createElement(DlBtn,{fmt:"TTF",size:f.ttf}),
            React.createElement(DlBtn,{fmt:"WOFF2",size:f.woff2})),
          React.createElement("div", { className:"fh-eyebrow", style:{ marginBottom:4 } },
            "Details"),
          React.createElement(MetaRow,{k:"glyphs",v:f.glyphs}),
          React.createElement(MetaRow,{k:"format",v: f.badge==="color"?"color · gradient"
            : f.badge==="line"?"single-line" : f.badge==="variable"?"variable" : "static"}),
          React.createElement(MetaRow,{k:"spacing",v:"kerned · 312 pairs"}),
          React.createElement(MetaRow,{k:"license",v:"free · ofl-style"}),
          React.createElement(MetaRow,{k:"visibility",v:f.vis}),
          React.createElement(MetaRow,{k:"built with",v:"fonthead maker"}),
          React.createElement("button", { className:"fh-btn",
            style:{ width:"100%", marginTop:22, justifyContent:"center" } },
            "use in a project  →")),
      ),

      React.createElement("footer", { style:{ padding:"22px 40px",
          borderTop:"1px solid var(--line)", display:"flex", justifyContent:"space-between" } },
        React.createElement("div", { className:"fh-mono", style:{ fontSize:11,
          color:"var(--ink-faint)" } }, "more from ", f.maker, " →"),
        React.createElement("div", { className:"fh-mono", style:{ fontSize:11,
          color:"var(--ink-faint)" } }, "report · embed · share")),
    )
  );
}

Object.assign(window, { FontPageScreen });
