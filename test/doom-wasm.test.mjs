import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// 벤더링한 DOOM wasm이 온전한지, doom-app.js가 부르는 함수들이 실제로
// 있는지 확인한다. 브라우저 없이 검증할 수 있는 유일한 부분이다.
const WASM_PATH = new URL("../vendor/wasm-doom/doom.wasm", import.meta.url);

test("doom.wasm이 컴파일되고 필요한 함수를 노출한다", async () => {
  const bytes = fs.readFileSync(WASM_PATH);
  assert.ok(bytes.length > 1_000_000, `크기가 이상하다 (${bytes.length}바이트)`);

  const module = await WebAssembly.compile(bytes);
  const exported = new Set(WebAssembly.Module.exports(module).map((entry) => entry.name));
  for (const name of ["main", "doom_loop_step", "add_browser_event"]) {
    assert.ok(exported.has(name), `export ${name} 없음`);
  }

  // 호스트가 채워줘야 하는 import 목록도 doom-app.js가 넘기는 것과 맞아야 한다.
  const imports = WebAssembly.Module.imports(module).map((entry) => `${entry.module}.${entry.name}`);
  for (const name of ["js.js_draw_screen", "js.js_milliseconds_since_start", "env.memory"]) {
    assert.ok(imports.includes(name), `import ${name} 없음 (${imports.join(", ")})`);
  }
});
