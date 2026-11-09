#!/bin/sh
# Measures the live site (masonbair.com), not a local build: these goals are about what visitors and crawlers get.
set -e
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
run() {
  npx -y lighthouse@13.6.0 "https://masonbair.com$1" --quiet --chrome-flags="--headless=new" \
    --only-categories=performance,accessibility,seo,agentic-browsing \
    --output=json --output-path="$out/$2.json" >/dev/null 2>&1
}
run / home
run /coffee coffee
jq -n --slurpfile h "$out/home.json" --slurpfile c "$out/coffee.json" '
  def s(r; k): (r.categories[k].score * 100 | round);
  def lcp(r): (r.audits["largest-contentful-paint"].numericValue / 1000 * 100 | round / 100);
  {
    home_speed: s($h[0]; "performance"), coffee_speed: s($c[0]; "performance"),
    home_search: s($h[0]; "seo"), coffee_search: s($c[0]; "seo"),
    home_access: s($h[0]; "accessibility"), coffee_access: s($c[0]; "accessibility"),
    home_agent: s($h[0]; "agentic-browsing"), coffee_agent: s($c[0]; "agentic-browsing"),
    home_lcp_s: lcp($h[0]), coffee_lcp_s: lcp($c[0])
  }'
