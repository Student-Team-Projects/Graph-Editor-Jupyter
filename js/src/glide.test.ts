import assert from "node:assert/strict";
import { test } from "node:test";
import { Glide } from "./glide";
import { MOVE_MS } from "./interaction";

function animation() {
  let id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const glide = new Glide(
    (callback) => { pending.set(++id, callback); return id; },
    (frame) => { pending.delete(frame); },
    () => 0,
  );
  const tick = (time: number) => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((callback) => callback(time));
  };
  return { glide, pending, tick };
}

test("rapid undo resolves the destination before saving the redo position", () => {
  const { glide, tick, pending } = animation();
  let x = 300;
  let completed = 0;
  glide.start((t) => { x = 300 + (200 - 300) * t; }, () => completed++);
  tick(MOVE_MS * 0.2);
  assert.equal(x, 280);
  glide.finish(); // the next history operation must do this before capturing positions
  const redoPosition = x;
  assert.equal(redoPosition, 200);
  assert.equal(completed, 1);
  assert.equal(pending.size, 0);
  glide.start((t) => { x = 200 + (100 - 200) * t; }, () => completed++);
  tick(MOVE_MS);
  assert.equal(x, 100);
  glide.start((t) => { x = 100 + (redoPosition - 100) * t; }, () => completed++);
  tick(MOVE_MS);
  assert.equal(x, 200);
  glide.finish();
  assert.equal(completed, 3);
});

test("reduced motion reaches the destination on the first frame", () => {
  const { glide, tick, pending } = animation();
  let progress = 0;
  glide.start((t) => { progress = t; }, () => {}, true);
  tick(1);
  assert.equal(progress, 1);
  assert.equal(pending.size, 0);
});

test("cancelling a glide does not apply its destination or completion callback", () => {
  const { glide, tick, pending } = animation();
  glide.start(() => assert.fail("cancelled animation updated"), () => assert.fail("cancelled animation completed"));
  glide.cancel();
  glide.finish();
  tick(MOVE_MS);
  assert.equal(pending.size, 0);
});
