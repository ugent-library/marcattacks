export const code =`
@prefix list: <http://www.w3.org/2000/10/swap/list#> .
@prefix log: <http://www.w3.org/2000/10/swap/log#> .
@prefix string: <http://www.w3.org/2000/10/swap/string#> .
@prefix math: <http://www.w3.org/2000/10/swap/math#> .
@prefix marc: <https://codeberg.org/phochste/marcattacks#> .

## Helper functions

# marc:splice - splice a list
{ (?List ?Idx) marc:splice ?Result }
<=
{
  ( ?X {
      ?List list:iterate (?Num ?X).
      ?Num math:notLessThan ?Idx.
      } ?Result ) log:collectAllIn _:x.
}.

# marc:join - join a list with a separator
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

# marc:id - return the record id 
{ ?Record marc:id ?Result }
<=
{
  (?Record "001") marc:field0 ?F001.
  ?F001 marc:ctrl ?ID. 
  ( "http://lib.ugent.be/record/" ?ID ) string:concatenation ?IRI_ID.
  ?Result log:uri ?IRI_ID.
}.

# marc:ctrl - return the control value of a field
{ ?Field marc:ctrl ?Result }
<=
{
  (?Field 3) list:memberAt "_" .
  (?Field 4) list:memberAt ?Result.
}.

# marc:subf - return all values matching a subfield regex
{ ( ?Field ?Regex) marc:subf ?Result }
<=
{
  ( ?Field 3) marc:splice ?FieldData.
  ( ?FieldData ?Regex ()) marc:subf ?Result.
} .

{ ( () ?Regex ?Acc ) marc:subf ?Acc } 
<= true.

{ ( ?FieldData ?Regex ?Acc ) marc:subf ?Result }
<=
{
    ?FieldData list:firstRest (?Subf ?Rest).
    ?Rest list:firstRest (?Value ?Tail).
    ?Subf string:matches ?Regex.
    ( ?Acc (?Value)) list:append ?Acc2.
    ( ?Tail ?Regex ?Acc2 ) marc:subf ?Result.
}.

{ ( ?FieldData ?Regex ?Acc ) marc:subf ?Result }
<=
{
    ?FieldData list:firstRest (?Subf ?Rest).
    ?Rest list:firstRest (?Value ?Tail).
    ?Subf string:notMatches ?Regex.
    ( ?Tail ?Regex ?Acc ) marc:subf ?Result.
}.

# marc:field0 - collect the first row of a marc field
{ ( ?Record ?Field) marc:field0 ?Result }
<=
{
  ( ?Record ?Field) marc:field ?F.
  ?F list:first ?Result.
}.

# marc:field - collect all data for a marc field
{ ( ?Record ?Field) marc:field ?Result}
<=
{
  ( ?Record ?Field ()) marc:field ?Result.
}.

{ ( () ?Field ?Acc ) marc:field ?Acc}
<= true.

{ ( ?L ?Field ?Acc ) marc:field ?Result }
<=
{
  ?L list:firstRest (?H ?T).
  ( ?H 0 ) list:memberAt ?Field.
  ( ?Acc (?H) ) list:append ?AccNew.
  (?T ?Field ?AccNew) marc:field ?Result.
}.

{ (?L ?Field ?Acc) marc:field ?Result }
<=
{
  ?L list:firstRest (?H ?T).
  ( ?H 0 ) list:memberAt ?X.
  ?Field log:notEqualTo ?X.
  (?T ?Field ?Acc) marc:field ?Result.
}.

{ ( ?Record ?Tag ?Subfield ) marc:map ?Result }
<=
{
  (?Record ?Tag) marc:field ?FL.
  ?FL list:member ?F. 
  (?F ?Subfield) marc:subf ?T .
  (?T " ") marc:join ?Result.
}.
## End Helper functions
`;