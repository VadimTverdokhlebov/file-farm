export function generateUUID(): string {
    const randomHex = () =>
        Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    return `${randomHex()}${randomHex()}-${randomHex()}-4${randomHex().substring(1)}-${(
        (parseInt(randomHex().charAt(0), 16) & 0x3) |
        0x8
    ).toString(16)}${randomHex().substring(1)}-${randomHex()}${randomHex()}`;
}
