interface MARCMapOpts {
    join_char?: string;
}

export function marcmap(record: string[][], find: string, opts: MARCMapOpts) : string[] {
    const fullOpts = {
        join_char: opts.join_char ?? " "
    };

    const results : string[] = [];

    const tagName = find.substring(0,3);
    const subMatch = find.substring(3) ? find.substring(3).split("").join("|") : ".*";
    const subRegex = new RegExp(`^${subMatch}$`);
    
    for (const row of record) {
        if (row[0] === tagName) {
            results.push(map_subfields(row,subRegex).join(fullOpts.join_char));
        }
    }
    
    return results;
}

function map_subfields(row: string[], re: RegExp) : string[] {
    const result : string[] = [];
    for (let i = 3 ; i < row.length ; i += 2) {
        if (row[i] !== undefined && row[i]?.match(re) && row[i+1] !== undefined) {
            result.push(row[i+1] as string);
        }

    }
    return result;
}