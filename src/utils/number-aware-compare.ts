const splitPartsPattern = /\d+|\D+/g;

export default function numberAwareCompare(a: string, b: string): number {
    const aComponents = a.match(splitPartsPattern) || [];
    const bComponents = b.match(splitPartsPattern) || [];

    while (aComponents.length > 0 && bComponents.length > 0) {
        const currentA = aComponents.shift() as string;
        const currentB = bComponents.shift() as string;
        const aAsInteger = parseInt(currentA, 10);
        const bAsInteger = parseInt(currentB, 10);

        if (!isNaN(aAsInteger) && !isNaN(bAsInteger)) {
            // Compare integers
            if (aAsInteger < bAsInteger) {
                return -1;
            } else if (aAsInteger > bAsInteger) {
                return 1;
            }
        } else if (isNaN(aAsInteger) && isNaN(bAsInteger)) {
            // Compare non-integer strings
            if (currentA < currentB) {
                return -1;
            } else if (currentA > currentB) {
                return 1;
            }
        } else {
            // If one block is an integer and the other a string,
            // the number is smaller
            if (isNaN(bAsInteger)) {
                return -1;
            } else {
                return 1;
            }
        }
    }

    if (aComponents.length === 0 && bComponents.length === 0) {
        return 0;
    } else if (aComponents.length === 0) {
        return -1;
    } else {
        return 1;
    }
}

// console.log(numberAwareCompare("bathroom10", "bathroom2"), 1)
// console.log(numberAwareCompare("bathroom2", "bathroom10"), -1)
// console.log(numberAwareCompare("2bathroom", "10bathroom"), -1)
// console.log(numberAwareCompare("10bathroom", "2bathroom"), 1)
// console.log(numberAwareCompare("1bathroom", "bathroom1"), -1)
// console.log(numberAwareCompare("bathroom1", "1bathroom"), 1)
// console.log(numberAwareCompare("bla", "bla"), 0)
// console.log(numberAwareCompare("bla1", "bla1"), 0)
// console.log(numberAwareCompare("bla1a4", "bla1a4"), 0)
// console.log(numberAwareCompare("", ""), 0)
// console.log(numberAwareCompare("a", ""), 1)
// console.log(numberAwareCompare("", "a"), -1)
// console.log(numberAwareCompare("2017.07.14", "2017.07.13"), 1)
// console.log(numberAwareCompare("bathroom-1", "bathroom1"), 1)
