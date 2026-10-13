// Message-template renderer for mu300-smsfwd (plain text, human channels).
// Input on stdin: {"template":"...","values":{from,text,time,phone,sim,device,kind}}
// Placeholders expand once; values are inserted literally (no re-scan, no
// command execution). Never throws out a partial line: on any error it
// prints nothing so the caller can fall back to the built-in template.
import { readfile } from 'fs';
function fill(s, v) {
    return replace(s, /\{(from|text|time|phone|sim|device|kind)\}/g,
        (all, key) => `${v[key] ?? ''}`);
}
try {
    let input = json(readfile('/dev/stdin'));
    let t = input.template, v = input.values ?? {};
    if (type(t) != 'string') exit(0);
    print(fill(t, v));
} catch (e) { /* print nothing: caller falls back */ }