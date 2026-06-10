import { Transform } from 'stream';

export function transform(opts,ctx) {
    const { marcmap } = ctx.utils;

    return new Transform({
        objectMode: true,
        transform(data, encoding, callback) {
           const record = data['record'];
           const id = marcmap(record,"001")[0];

           for (let i = 0 ; i < record.length ; i++) {
            const field = record[i];
            const tag   = field[0];
            const ind1  = field[1];
            const ind2  = field[2];
            let value   = "";

            if (tag.match(/^LDR|\d{3}$/)) {
                for (let j = 3 ; j < field.length ; j += 2) {
                    if (value != "") {
                        value += " ";
                    }
                    if (field[j] === '_') {
                        value += field[j+1];
                    }
                    else {
                        value += field[j+1];
                    }
                }
            }
            else {
                value = null;
            }

            let subf = [];

            if (tag.match(/^[123456789]/)) {
                for (let j = 3 ; j < field.length ; j += 2) {
                    subf.push({ code: field[j] , value: field[j+1] });
                }
            }
            else {
                subf = null;
            }

            this.push({
                "record_id" : id,
                "field_seq" : i,
                "tag": tag,
                "ind1": ind1,
                "ind2": ind2,
                "value": value,
                "subfields": subf
            });
           }

           callback(null);
        }
    });
}