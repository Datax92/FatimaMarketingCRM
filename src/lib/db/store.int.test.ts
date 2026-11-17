/**
 * The document store against the real Neon database.
 *
 *   npm run test:db
 *
 * Every test writes under its own throwaway top-level collection and deletes
 * it afterwards, so it is safe against a live database.
 */
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FieldPath, FieldValue, Timestamp, getFirestore, type Firestore } from "./firestore.ts";
import { getPool } from "./pg.ts";

const db: Firestore = getFirestore();
const run = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const C = (name: string) => `__test_${run}_${name}`;
const made = new Set<string>();
const coll = (name: string) => {
  made.add(C(name));
  return db.collection(C(name));
};

after(async () => {
  for (const name of made) await db.recursiveDelete(db.collection(name));
  await db.recursiveDelete(db.collection("leads").doc(`${run}_lead`));
  await getPool().end();
});

describe("documents", () => {
  test("set, get, merge, update, create, delete", async () => {
    const ref = coll("docs").doc("a");
    await ref.set({ name: "Aroosa", nested: { a: 1, b: 2 }, tags: ["x"] });
    let snap = await ref.get();
    assert.equal(snap.exists, true);
    assert.deepEqual(snap.data(), { name: "Aroosa", nested: { a: 1, b: 2 }, tags: ["x"] });

    await ref.set({ nested: { b: 3, c: 4 } }, { merge: true });
    snap = await ref.get();
    assert.deepEqual(snap.data()?.nested, { a: 1, b: 3, c: 4 });
    assert.equal(snap.data()?.name, "Aroosa");

    await ref.update({ "nested.a": 10, name: FieldValue.delete() });
    snap = await ref.get();
    assert.deepEqual(snap.data(), { nested: { a: 10, b: 3, c: 4 }, tags: ["x"] });

    await assert.rejects(coll("docs").doc("missing").update({ a: 1 }), (error: { code?: number }) => error.code === 5);
    await assert.rejects(ref.create({ a: 1 }), (error: { code?: number }) => error.code === 6);

    await ref.delete();
    assert.equal((await ref.get()).exists, false);
  });

  test("transforms: increment, arrayUnion/Remove, serverTimestamp", async () => {
    const ref = coll("transforms").doc("t");
    await ref.set({ count: FieldValue.increment(2), list: FieldValue.arrayUnion("a", "b"), at: FieldValue.serverTimestamp() });
    await ref.update({ count: FieldValue.increment(3), list: FieldValue.arrayUnion("b", "c") });
    await ref.update({ list: FieldValue.arrayRemove("a") });
    const data = (await ref.get()).data()!;
    assert.equal(data.count, 5);
    assert.deepEqual(data.list, ["b", "c"]);
    assert.ok(data.at instanceof Timestamp);
    assert.ok(Math.abs(data.at.toMillis() - Date.now()) < 60_000);
  });

  test("dates come back as Timestamps", async () => {
    const ref = coll("dates").doc("d");
    const when = new Date("2026-09-01T10:00:00Z");
    await ref.set({ when, ts: Timestamp.fromDate(when) });
    const data = (await ref.get()).data()!;
    assert.equal(data.when.toDate().toISOString(), when.toISOString());
    assert.equal(data.ts.toMillis(), when.getTime());
  });

  test("subcollections, collection groups, references", async () => {
    const parent = coll("parents").doc("p1");
    await parent.collection("kids").doc("k1").set({ dayKey: "2026-09-01", uid: "u1" });
    await parent.collection("kids").doc("k2").set({ dayKey: "2026-09-02", uid: "u2" });
    await coll("parents").doc("p2").collection("kids").doc("k3").set({ dayKey: "2026-09-03", uid: "u1" });
    const own = await parent.collection("kids").get();
    assert.equal(own.size, 2);
    const group = await db.collectionGroup("kids").where("uid", "==", "u1").where("dayKey", ">=", "2026-09-01").get();
    const mine = group.docs.filter((doc) => doc.ref.path.startsWith(C("parents")));
    assert.deepEqual(mine.map((doc) => doc.id).sort(), ["k1", "k3"]);
    assert.equal(mine[0].ref.parent.parent?.parent.id, C("parents"));
  });
});

describe("queries", () => {
  test("filters, ordering, limits, cursors, counts", async () => {
    const c = coll("q");
    const base = Date.parse("2026-09-01T00:00:00Z");
    for (let i = 0; i < 6; i++) {
      await c.doc(`d${i}`).set({
        n: i,
        status: i % 2 === 0 ? "OPEN" : "CLOSED",
        createdAt: new Date(base + i * 3600_000),
        tags: i < 3 ? ["early"] : ["late"],
        flag: i === 5 ? true : null,
      });
    }

    const open = await c.where("status", "==", "OPEN").orderBy("createdAt", "desc").get();
    assert.deepEqual(open.docs.map((d) => d.id), ["d4", "d2", "d0"]);

    const since = await c.where("createdAt", ">=", new Date(base + 2 * 3600_000)).orderBy("createdAt").limit(2).get();
    assert.deepEqual(since.docs.map((d) => d.id), ["d2", "d3"]);

    const inQ = await c.where("n", "in", [1, 4, 9]).get();
    assert.deepEqual(inQ.docs.map((d) => d.id), ["d1", "d4"]);

    const byId = await c.where(FieldPath.documentId(), "in", ["d0", "d5"]).get();
    assert.deepEqual(byId.docs.map((d) => d.id), ["d0", "d5"]);

    const contains = await c.where("tags", "array-contains", "late").get();
    assert.equal(contains.size, 3);

    const notEq = await c.where("status", "!=", "OPEN").get();
    assert.equal(notEq.size, 3);

    // A range on a number never matches a boolean or a null, as in Firestore.
    const range = await c.where("n", ">", 3).get();
    assert.deepEqual(range.docs.map((d) => d.id), ["d4", "d5"]);

    const page1 = await c.orderBy("n").limit(2).get();
    const page2 = await c.orderBy("n").startAfter(page1.docs[1]).limit(2).get();
    assert.deepEqual(page2.docs.map((d) => d.id), ["d2", "d3"]);

    const last = await c.orderBy("n").limitToLast(2).get();
    assert.deepEqual(last.docs.map((d) => d.id), ["d4", "d5"]);

    const counted = await c.where("status", "==", "CLOSED").count().get();
    assert.equal(counted.data().count, 3);

    // A missing field drops the document from an ordered query.
    await c.doc("nofield").set({ status: "OPEN" });
    const ordered = await c.orderBy("n").get();
    assert.equal(ordered.size, 6);
  });

  test("nested fields", async () => {
    const c = coll("nested");
    await c.doc("a").set({ profile: { city: "Lahore" } });
    await c.doc("b").set({ profile: { city: "Karachi" } });
    const found = await c.where("profile.city", "==", "Karachi").get();
    assert.deepEqual(found.docs.map((d) => d.id), ["b"]);
  });
});

describe("batches and transactions", () => {
  test("a batch is atomic", async () => {
    const c = coll("batch");
    await c.doc("exists").set({ a: 1 });
    const batch = db.batch();
    batch.set(c.doc("one"), { a: 1 });
    batch.create(c.doc("exists"), { a: 2 }); // fails, so nothing commits
    await assert.rejects(batch.commit());
    assert.equal((await c.doc("one").get()).exists, false);
  });

  test("concurrent transactions do not lose updates", async () => {
    const ref = coll("counter").doc("c");
    await ref.set({ n: 0 });
    await Promise.all(
      Array.from({ length: 8 }, () =>
        db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          tx.update(ref, { n: (snap.data()!.n as number) + 1 });
        })
      )
    );
    assert.equal((await ref.get()).data()!.n, 8);
  });

  test("a throwing transaction writes nothing", async () => {
    const ref = coll("rollback").doc("r");
    await ref.set({ n: 1 });
    await assert.rejects(
      db.runTransaction(async (tx) => {
        tx.update(ref, { n: 2 });
        throw new Error("refused");
      })
    );
    assert.equal((await ref.get()).data()!.n, 1);
  });

  test("every write to a lead stamps updatedAt", async () => {
    const ref = db.collection("leads").doc(`${run}_lead`);
    await ref.set({ name: "x" });
    const first = (await ref.get()).data()!.updatedAt;
    assert.ok(first instanceof Timestamp);
    await ref.collection("followUps").doc("f").set({ a: 1 });
    assert.equal((await ref.collection("followUps").doc("f").get()).data()!.updatedAt, undefined);
  });
});
