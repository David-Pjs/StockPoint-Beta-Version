
# DevTools Cheats

**Switch plans quickly** (paste each line in DevTools Console):

```js
// Free
localStorage.setItem("sp.license", JSON.stringify({ plan:"free", status:"active", updatedAt:Date.now() })); location.reload();

// Pro (small)
localStorage.setItem("sp.license", JSON.stringify({ plan:"small", status:"active", updatedAt:Date.now() })); location.reload();

// Enterprise (large)
localStorage.setItem("sp.license", JSON.stringify({ plan:"large", status:"active", updatedAt:Date.now() })); location.reload();

// Past due with 2-day grace
const lic = JSON.parse(localStorage.getItem("sp.license")||"{}");
lic.status = "past_due"; lic.grace_days = 2; lic.grace_until = Date.now() + 2*24*60*60*1000;
localStorage.setItem("sp.license", JSON.stringify(lic)); location.reload();
```

**Clean old state** (avoids NaN & stale crashes):
```js
localStorage.removeItem("sp.license");
localStorage.removeItem("sp.brand");
localStorage.removeItem("sp.users");
localStorage.removeItem("sp.products");
indexedDB?.databases?.().then(db=>db.forEach(d=>indexedDB.deleteDatabase(d.name)));
caches?.keys?.().then(keys=>keys.forEach(k=>caches.delete(k)));
sessionStorage.clear();
```
