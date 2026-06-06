# Catmandu Fix support in marcattacks

marcattacks ships a small, embedded implementation of the
[Catmandu](https://github.com/LibreCat/Catmandu) **Fix** language, usable as a
transform mapper:

```sh
marcattacks --to jsonl --map fix --param fix=./my.fix ./data/sample.xml
```

It implements **a subset of the most common Fix builtins**. Path semantics
follow `Catmandu::Path::simple` and the function/condition semantics are ported
from Catmandu's own test suite (`tests/fix/conformance.test.ts`). This document
lists exactly what is and isn't supported, so you know before porting a Catmandu
Fix script.

> The full upstream Fix reference is the
> [Catmandu cheat sheet](https://librecat.org/assets/catmandu_cheat_sheet.pdf).

**Source of truth in this repo:**

| Concern | File |
| --- | --- |
| Fix functions | `src/fix/fixes.ts` |
| Conditions (`if`/`unless`) | `src/fix/conditions.ts` |
| Binds (`do`/`doset`) | `src/fix/binds.ts` |
| Path / selector engine | `src/fix/path.ts` |
| Parser | `src/fix/parser.ts` |
| Compiler / runner | `src/fix/index.ts` |

---

## Syntax

A Fix script is a list of `name(args)` statements, separated by newlines, `;` or
`,`. Comments start with `#` and run to end of line.

```text
marc_map('245ab', title, join: ' ')   # extract MARC 245$a$b into title
upcase(title)                          # uppercase it
add_field(type, Book)                  # add a constant field
lookup(type, ./types.csv)              # map via a CSV table

do marc_each()                         # loop over each MARC field
  unless marc_match('500e', skip)
    marc_map('500', note.$append)
  end
end

remove_field(record)
```

### Argument syntax

- Bare words: `add_field(type, Book)`
- Single-quoted strings keep backslashes except `\'` → `'`
- Double-quoted strings support `\n \r \t \b \f \\ \"` and `\uXXXX`
- Separators `,`, `:` and `=>` are all interchangeable, so named options can be
  written `join: ' '`, `join => ' '`, or `join, ' '`.

---

## Path / selector syntax

Ported from `Catmandu::Path::simple` (`src/fix/path.ts`):

| Path | Meaning |
| --- | --- |
| `.` | the whole record (root / empty path) |
| `foo.bar` | nested hash keys |
| `foo.0` | array index (or hash key `"0"`) |
| `foo.*` | every element of an array |
| `foo.$first` / `foo.$last` | first / last array element |
| `foo.$append` / `foo.$prepend` | append / prepend (create-only) |
| `'a.b'` / `"a b"` | quoted keys (may contain dots/spaces); `''` is the empty key |

Both `.` and `/` work as path separators; escape a literal separator with `\`.

---

## Supported Fix functions

All defined in `src/fix/fixes.ts` (the `FIXES` table).

### Field creation / movement

| Function | Notes |
| --- | --- |
| `add_field(path, value)` | create/append a field (value defaults to `null`) |
| `set_field(path, value)` | set only where the intermediate path already exists |
| `remove_field(path)` | delete a field |
| `copy_field(old, new)` | copy (deep-cloned) value to a new path |
| `move_field(old, new)` | copy then delete the source |

### String transforms

These act only on existing string values.

| Function | Notes |
| --- | --- |
| `upcase(path)` | |
| `downcase(path)` | |
| `capitalize(path)` | lowercases, then capitalizes first char |
| `trim(path, [mode])` | `mode` = `whitespace` (default), `nonword`, or `diacritics` |
| `prepend(path, str)` | |
| `append(path, str)` | |
| `replace_all(path, search, replace)` | regex substitution, `$1`/`${1}` backrefs |
| `substring(path, off, [len], [replacement])` | extract or replace a substring |
| `format(path, spec)` | sprintf-style; works on a value, array, or hash |
| `paste(target, parts…, [join_char, c])` | concatenate fields/literals; `~text` = literal |

### Array ↔ string / array ops

| Function | Notes |
| --- | --- |
| `join_field(path, [sep])` | array → string (sep defaults to a space) |
| `split_field(path, [sep])` | string → array (sep is a regex) |
| `sort_field(path, [uniq:1], [reverse:1], [numeric:1])` | |
| `uniq(path)` | drop duplicate array values (keep first) |
| `filter(path, regex, [invert:1])` | keep array values (not) matching the regex |
| `flatten(path)` | recursively flatten nested arrays |
| `compact(path)` | drop `null`/`undefined` from an array |
| `count(path)` | replace an array/hash with its size |

### Constructors / structure

| Function | Notes |
| --- | --- |
| `set_array(path, v…)` | set to a fresh array |
| `set_hash(path, k, v, …)` | set to a fresh hash |
| `from_json(path)` / `to_json(path)` | parse / stringify JSON |
| `rename(path, search, replace)` | regex-rename hash keys (recursive) |
| `collapse([sep])` / `expand([sep])` | whole-record flatten / nest by dotted keys |
| `vacuum()` | recursively delete empty fields (`null`, blank, `[]`, `{}`) |
| `parse_text(path, pattern)` | regex → hash (named groups) / array (numbered) |

### Value coercion

| Function | Notes |
| --- | --- |
| `int(path)` | first integer in a string, else array/hash size, else 0 |
| `string(path)` | stringify value / join array / join hash values (sorted keys) |
| `uri_encode(path)` / `uri_decode(path)` | percent-encoding |
| `expand_date([field=date])` | split a date into `year`/`month`/`day` at root |

### Lookup / retention

| Function | Notes |
| --- | --- |
| `lookup(path, file, [default:x], [delete:1], [sep_char:c])` | map values through a 2-column CSV (key,val; no header) |
| `retain(path…)` | keep only the listed paths, drop everything else |
| `retain_field(path)` | delete every sibling of the final key |

### MARC-specific

| Function | Notes |
| --- | --- |
| `marc_map(marc_path, json_path, [split:1], [join:str], [value:str])` | extract MARC fields into a JSON path; default `join` is empty; supports a substring suffix such as `008/35-37` |
| `marc_remove(tag)` | drop all MARC fields with the given tag |

### Control / misc

| Function | Notes |
| --- | --- |
| `reject()` | drop the current record/field (used inside binds like `marc_each`) |
| `genid(path)` | write a fresh `genid:<uuid>` into each terminal slot |
| `nothing()` | no-op |

---

## Supported conditions (`if` / `unless`)

All defined in `src/fix/conditions.ts`. `if`/`unless ... [else] ... end` blocks
are supported.

Most "is_*" conditions use Catmandu's `Builder::Simple` *all_u* semantics: true
iff there is **at least one** value at the path **and all** values pass the test.

### Generic

| Condition | Notes |
| --- | --- |
| `exists(path)` | |
| `all_match(path, regex)` / `any_match(path, regex)` | |
| `all_equal(path, value)` / `any_equal(path, value)` | |
| `is_string(path)` / `is_array(path)` / `is_object(path)` | |
| `is_number(path)` | accepts numeric strings |
| `is_null(path)` | |
| `is_true(path, [strict:1])` / `is_false(path, [strict:1])` | loose: accepts `1`/`0`, `"true"`/`"false"` |
| `greater_than(path, n)` / `less_than(path, n)` | |
| `in(path1, path2)` | value-wise containment between two paths |

### MARC

| Condition | Notes |
| --- | --- |
| `marc_match(path, regex)` / `marc_any_match(path, regex)` | any MARC value matches |
| `marc_all_match(path, regex)` | all MARC values match |
| `marc_has(tag)` | the tag is present |
| `marc_has_many(tag)` | the tag occurs more than once |

---

## Supported binds (`do` / `doset`)

Defined in `src/fix/binds.ts`. `do BIND(...) ... end` returns the original
record; `doset BIND(...) ... end` returns the bound result. Binds are fully
compiled (see `src/fix/index.ts`).

| Bind | Notes |
| --- | --- |
| `list(path:p, var:name)` | iterate an array (or run once over a hash); both options optional |
| `marc_each(var:name)` | iterate each MARC field; `reject()` drops a field; optional `var` exposes a `{tag, ind1, ind2, subfields}` hash |
| `identity` | run the block as-is (also the fallback for any unknown bind name) |

> Note: an unrecognised bind name does **not** raise an error — it falls back to
> `identity` (runs the block without bind semantics). An unrecognised **fix** or
> **condition** name *does* throw.

---

## NOT supported

The following are part of standard Catmandu/`Catmandu::MARC` but are **not**
implemented here. This list is illustrative, not exhaustive — anything not in the
tables above is unsupported.

### Generic fixes not implemented

- `sum`, `reverse`, `hash`, `array`
- `import`, `export`, `lookup_in_store`, `search_in_store`, `add_to_store`
- `assoc` / `each` style transforms beyond those listed
- `clone`, `log`, `error`, `parse_date`, `sleep`, etc.

### MARC fixes not implemented

- `marc_add` — adding MARC fields
- `marc_set` — setting MARC subfield values in place
- `marc_copy` / `marc_cut` / `marc_paste`
- `marc_xml`, `marc_in_json`, `marc_decode_dollar_subfields`
- `marc_spec`-based addressing (only the simple `TAG+subcodes` and `TAG/from-to`
  forms are supported)

> marcattacks can **read** MARC (via `marc_map`, `marc_each`, the `marc_*`
> conditions) and **remove** fields (`marc_remove`), but it has **no builtin for
> writing/mutating MARC fields in place**. Build the JSON record you want with
> the generic fixes instead, or remove `record` and emit the mapped structure.

### Binds not implemented

- `maybe`, `visitor`, `with`, `hashmap`, `each`, `timing`
  (all unknown binds silently degrade to `identity`)

### Conditions not implemented

- `is_false`/`is_true` aside, no `is_*` beyond the list above
- store/lookup-based conditions (`*_in_store`)

### Language features

- No custom path languages (`Catmandu::Path::*` other than `simple`)
- No `reject`/`select` as top-level conditionals (use `if`/`unless` + `reject()`)
- No user-defined fixes, `include`, or external Fix modules

---

## Examples in this repo

- `demo/example.fix` — `copy_field`, `upcase`, `move_field`, `split_field`,
  `join_field`, `replace_all`, `paste`
- `demo/marc2rdf.fix` — production example: `marc_map`, conditionals, `marc_each`,
  `genid`, `prepend`, `replace_all`
- `tests/fix/conformance.test.ts` — behaviour ported verbatim from Catmandu's own
  `t/Catmandu-Fix-*.t` test cases; the most precise spec of the supported subset
