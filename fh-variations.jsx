/* fonthead.dev — variations. Alternate treatments for the two loudest
   decisions: the hero masthead, and the wall card. Same system throughout. */

const { useState:useSV, useEffect:useEV } = React;

/* ============ HERO VARIANTS ============ */

// shared tiny cycler that returns the current face index
function useCycle(n, ms=2600){
  const [i,setI]=useSV(0);
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEV(()=>{ if(reduce) return; const t=setInterval(()=>setI(v=>(v+1)%n),ms); return ()=>clearInterval(t); },[]);
  return reduce?0:i;
}

// A · Split feature: cycling word left, the day's top three right
function HeroSplit(){
  const i = useCycle(FH_HERO_FACES.length);
  const f = FH_HERO_FACES[i];
  const top = FH_FONTS.slice(0,3);
  return React.createElement("div",{className:"fh",style:{width:760,height:380,
      display:"flex",flexDirection:"column"}},
    React.createElement("div",{className:"fh-nav",style:{height:54,padding:"0 28px"}},
      React.createElement("div",{className:"fh-wordmark",style:{fontSize:14}},"fonthead",
        React.createElement("span",{className:"dot"},".dev")),
      React.createElement("div",{style:{flex:1}}),
      React.createElement("span",{className:"fh-eyebrow",style:{fontSize:10}},"yesterday's top")),
    React.createElement("div",{style:{flex:1,display:"grid",gridTemplateColumns:"1.3fr 1fr"}},
      React.createElement("div",{style:{display:"flex",alignItems:"center",justifyContent:"center",
          borderRight:"1px solid var(--line)",padding:24}},
        React.createElement("span",{className:specClass(f),style:{...specStyle(f),fontSize:92,
          lineHeight:.9,whiteSpace:"nowrap",transition:"opacity .2s var(--ease)"}},"fonthead")),
      React.createElement("div",{style:{padding:"22px 26px",display:"flex",flexDirection:"column",
          justifyContent:"center",gap:16}},
        React.createElement("span",{className:"fh-eyebrow",style:{fontSize:10}},"featured today"),
        top.map(t=>React.createElement("div",{key:t.id,style:{display:"flex",alignItems:"baseline",
            justifyContent:"space-between",gap:12,borderBottom:"1px solid var(--line)",paddingBottom:10}},
          React.createElement("span",{className:specClass(t),style:{...specStyle(t),fontSize:30,
            whiteSpace:"nowrap",maxWidth:170,overflow:"hidden"}},t.word),
          React.createElement("span",{className:"fh-mono",style:{fontSize:10,color:"var(--ink-faint)"}},
            "↑"+t.votes))))));
}

// B · Specimen ticker: word static, faces scroll beneath
function HeroTicker(){
  const faces=[...FH_FONTS];
  const strip = React.createElement("div",{className:"fh-marq"},
    faces.concat(faces).map((t,i)=>React.createElement("span",{key:i,className:specClass(t),
      style:{...specStyle(t),fontSize:44,whiteSpace:"nowrap"}},t.word)));
  return React.createElement("div",{className:"fh",style:{width:760,height:380,
      display:"flex",flexDirection:"column"}},
    React.createElement("div",{className:"fh-nav",style:{height:54,padding:"0 28px"}},
      React.createElement("div",{className:"fh-wordmark",style:{fontSize:14}},"fonthead",
        React.createElement("span",{className:"dot"},".dev"))),
    React.createElement("div",{style:{flex:1,display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",gap:26}},
      React.createElement("span",{style:{fontFamily:"'Anton',sans-serif",fontSize:108,
        letterSpacing:"-.02em",lineHeight:.9}},"fonthead"),
      React.createElement("div",{className:"fh-marq-mask",style:{width:"100%"}}, strip)),
    React.createElement("div",{style:{padding:"12px 28px",borderTop:"1px solid var(--line)"}},
      React.createElement("span",{className:"fh-mono",style:{fontSize:10.5,color:"var(--ink-faint)"}},
        "every face below is a community font · scroll continues")));
}

/* ============ CARD VARIANTS ============ */

// B · Quiet: type does all the talking. specimen + name, nothing else.
function CardQuiet(){
  const f = FH_FONTS.find(x=>x.id==="marigold");
  return React.createElement("div",{className:"fh",style:{width:360,padding:0}},
    React.createElement("article",{className:"fh-card",style:{display:"flex",flexDirection:"column"}},
      React.createElement("div",{style:{height:200,display:"grid",placeItems:"center"}},
        React.createElement("span",{className:specClass(f),style:{...specStyle(f),fontSize:78}},f.word)),
      React.createElement("div",{style:{padding:"16px 18px",borderTop:"1px solid var(--line)",
          display:"flex",alignItems:"baseline",justifyContent:"space-between"}},
        React.createElement("div",null,
          React.createElement("div",{style:{fontSize:15,fontWeight:600}},f.name),
          React.createElement("div",{className:"fh-mono",style:{fontSize:11,color:"var(--ink-faint)",
            marginTop:3}},f.maker)),
        React.createElement("span",{className:"fh-mono",style:{fontSize:11,color:"var(--ink-faint)"}},
          "↑ "+f.votes))));
}

// C · Editorial: a mini specimen sheet — pangram + size ladder.
function CardEditorial(){
  const f = FH_FONTS.find(x=>x.id==="fatcap");
  return React.createElement("div",{className:"fh",style:{width:360,padding:0}},
    React.createElement("article",{className:"fh-card",style:{display:"flex",flexDirection:"column"}},
      React.createElement("div",{style:{padding:"20px 20px 0"}},
        React.createElement("div",{style:{display:"flex",justifyContent:"space-between",
            alignItems:"baseline",marginBottom:12}},
          React.createElement("span",{style:{fontSize:14,fontWeight:600}},f.name),
          React.createElement("span",{className:"fh-mono",style:{fontSize:10.5,
            color:"var(--ink-faint)"}},f.maker)),
        React.createElement("div",{className:specClass(f),style:{...specStyle(f),fontSize:62,
          lineHeight:.95}},"Aa"),
        React.createElement("div",{style:{...specStyle(f),fontSize:18,lineHeight:1.2,
          color:"var(--ink)",marginTop:10}},"The quick brown fox jumps over the lazy dog")),
      React.createElement("div",{style:{padding:"14px 20px",marginTop:14,
          borderTop:"1px solid var(--line)",display:"flex",gap:14,alignItems:"baseline"}},
        [48,24,14].map(s=>React.createElement("span",{key:s,style:{...specStyle(f),fontSize:s,
          color:"var(--ink-soft)"}},"Aa")),
        React.createElement("span",{style:{flex:1}}),
        React.createElement("span",{className:"fh-mono",style:{fontSize:10,color:"var(--ink-faint)"}},
          f.glyphs+" glyphs"))));
}

Object.assign(window,{ HeroSplit, HeroTicker, CardQuiet, CardEditorial });
