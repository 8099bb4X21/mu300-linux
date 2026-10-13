def tk:
  [match("\\$(\\d)|[^$]+|\\$(?!\\d)"; "g")
   | if .captures[0].string != null then { n: .captures[0].string }
     else { s: .string }
     end];
def expand($caps):
  map(
    if has("n") then (($caps)[(.n | tonumber) - 1].string // "")
    else .s
    end
  ) | join("") | gsub("\\\\n"; "\n");
def do_sub($t; $p; $rt):
  [$t | match($p; "g")] as $ms
  | if ($ms | length) == 0 then ""
    else
      (reduce range(0; ($ms | length)) as $i (
         { out: "", pos: 0 };
         . as $st | $ms[$i] as $m
         | ($rt | expand($m.captures)) as $rp
         | { out: (.out + $t[.pos:$m.offset] + $rp),
             pos: ($m.offset + $m.length) }
       )) as $acc
      | $acc.out + $t[$acc.pos:]
    end;
. as $tx | do_sub($tx; $p; ($rp | tk))
