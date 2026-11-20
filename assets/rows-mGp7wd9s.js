function i(r,...e){const s=["request-row",...e.filter(t=>typeof t=="string"&&t)];return r.alert&&s.push("is-alert"),r.correct||s.push("is-mistake"),s.join(" ")}export{i as r};
