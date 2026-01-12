export const code =`
@prefix list: <http://www.w3.org/2000/10/swap/list#> .
@prefix log: <http://www.w3.org/2000/10/swap/log#> .
@prefix string: <http://www.w3.org/2000/10/swap/string#> .
@prefix math: <http://www.w3.org/2000/10/swap/math#> .
@prefix marc: <https://codeberg.org/phochste/marcattacks#> .

## Helper functions

# marc:splice splice a list
{ (?List ?Idx) marc:splice ?Result }
<=
{
  ( ?X {
      ?List list:iterate (?Num ?X).
      ?Num math:notLessThan ?Idx.
      } ?Result ) log:collectAllIn _:x.
}.

# marc:join a list with a separator
{ (?List ?Sep) marc:join ?Result }
<=
{
  (?List ?Sep "") marc:join ?Result.
}.

{ ( () ?Sep ?Acc ) marc:join ?Acc }
<= true.

{ ( ?List ?Sep ?Acc ) marc:join ?Result }
<=
{
  ?List list:firstRest (?H ?T).
  ?Acc log:equalTo "".
  ( ?T ?Sep ?H ) marc:join ?Result .
}.

{ ( ?List ?Sep ?Acc ) marc:join ?Result }
<=
{
  ?List list:firstRest (?H ?T).
  ?Acc log:notEqualTo "".
  ( ?Acc ?Sep ?H) string:concatenation ?AccNew.
  ( ?T ?Sep ?AccNew ) marc:join ?Result .
}.

# marcid: return the record id 
{ ?Record marc:marcid ?Result }
<=
{
  (?Record "001") marc:marcfield0 ?F001.
  ?F001 marc:marcctrl ?ID. 
  ( "http://lib.ugent.be/record/" ?ID ) string:concatenation ?IRI_ID.
  ?Result log:uri ?IRI_ID.
}.

# marcctrl: return the control value of a field
{ ?Field marc:marcctrl ?Result }
<=
{
  (?Field 3) list:memberAt "_" .
  (?Field 4) list:memberAt ?Result.
}.

# marcsubf: return all values matching a subfield regex
{ ( ?Field ?Regex) marc:marcsubf ?Result }
<=
{
  ( ?Field 3) marc:splice ?FieldData.
  ( ?FieldData ?Regex ()) marc:marcsubf ?Result.
} .

{ ( () ?Regex ?Acc ) marc:marcsubf ?Acc } 
<= true.

{ ( ?FieldData ?Regex ?Acc ) marc:marcsubf ?Result }
<=
{
    ?FieldData list:firstRest (?Subf ?Rest).
    ?Rest list:firstRest (?Value ?Tail).
    ?Subf string:matches ?Regex.
    ( ?Acc (?Value)) list:append ?Acc2.
    ( ?Tail ?Regex ?Acc2 ) marc:marcsubf ?Result.
}.

{ ( ?FieldData ?Regex ?Acc ) marc:marcsubf ?Result }
<=
{
    ?FieldData list:firstRest (?Subf ?Rest).
    ?Rest list:firstRest (?Value ?Tail).
    ?Subf string:notMatches ?Regex.
    ( ?Tail ?Regex ?Acc ) marc:marcsubf ?Result.
}.

# marcfield0: collect the first row of a marc field
{ ( ?Record ?Field) marc:marcfield0 ?Result }
<=
{
  ( ?Record ?Field) marc:marcfield ?F.
  ?F list:first ?Result.
}.

# marcfield: collect all data for a marc field
{ ( ?Record ?Field) marc:marcfield ?Result}
<=
{
  ( ?Record ?Field ()) marc:marcfield ?Result.
}.

{ ( () ?Field ?Acc ) marc:marcfield ?Acc}
<= true.

{ ( ?L ?Field ?Acc ) marc:marcfield ?Result }
<=
{
  ?L list:firstRest (?H ?T).
  ( ?H 0 ) list:memberAt ?Field.
  ( ?Acc (?H) ) list:append ?AccNew.
  (?T ?Field ?AccNew) marc:marcfield ?Result.
}.

{ (?L ?Field ?Acc) marc:marcfield ?Result }
<=
{
  ?L list:firstRest (?H ?T).
  ( ?H 0 ) list:memberAt ?X.
  ?Field log:notEqualTo ?X.
  (?T ?Field ?Acc) marc:marcfield ?Result.
}.

{ ( ?Record ?Tag ?Subfield ) marc:marcmap ?Result }
<=
{
  (?Record ?Tag) marc:marcfield ?FL.
  ?FL list:member ?F. 
  (?F ?Subfield) marc:marcsubf ?T .
  (?T " ") marc:join ?Result.
}.
## End Helper functions
`;