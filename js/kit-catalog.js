// Kit / platform catalog (kit_platforms table, sql/kit_platforms.sql), shared
// by intake.html (customer type-ahead) and admin-dashboard.html (build form,
// Platforms tab, "not in catalog" flag on intake rows). The Worker has its
// own copy of the same matching rule in src/lib/kitPlatforms.js - keep the
// two in step.
//
// Matching ignores case, spaces and punctuation, so "pm 12", "PM-12" and
// "Pm12" are all the same key. A catalog name's aliases carry the spellings
// that are genuinely different ("Model 12" for the PM-12).
var KitCatalog = (function () {
  var rows = [];

  function key(t) {
    return String(t == null ? '' : t).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Never throws: the catalog is a convenience on top of a free-text field,
  // so if it can't load the field just stays plain text.
  function load(client) {
    return Promise.resolve(client.from('kit_platforms').select('name, aliases, default_caliber, is_active').order('name'))
      .then(function (res) {
        rows = res.error ? [] : (res.data || []).filter(function (r) { return r.is_active !== false; });
        return rows;
      })
      .catch(function () { rows = []; return rows; });
  }

  function set(newRows) {
    rows = (newRows || []).filter(function (r) { return r.is_active !== false; });
  }

  function all() { return rows; }

  // The catalog row whose name or alias is exactly this text, or null.
  function match(typed) {
    var k = key(typed);
    if (!k) return null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (key(r.name) === k) return r;
      var al = r.aliases || [];
      for (var j = 0; j < al.length; j++) if (key(al[j]) === k) return r;
    }
    return null;
  }

  // Suggestions for a partial entry: names/aliases that start with it first,
  // then ones that merely contain it. Empty entry lists the first few names.
  function search(q, limit) {
    limit = limit || 8;
    var k = key(q);
    if (!k) return rows.slice(0, limit);
    var starts = [], contains = [];
    rows.forEach(function (r) {
      var keys = [key(r.name)].concat((r.aliases || []).map(key));
      if (keys.some(function (x) { return x.indexOf(k) === 0; })) starts.push(r);
      else if (keys.some(function (x) { return x.indexOf(k) !== -1; })) contains.push(r);
    });
    return starts.concat(contains).slice(0, limit);
  }

  return { key: key, load: load, set: set, all: all, match: match, search: search };
})();
