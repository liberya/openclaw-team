export const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw3xJ
-----END PUBLIC KEY-----`;

export async function encryptPassword(password: string): Promise<string> {
    if (typeof window === "undefined" || typeof crypto === "undefined") {
        return password;
    }
    
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    
    const publicKeyPem = PUBLIC_KEY
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .replace(/\s/g, "");
    
    const binaryDer = Uint8Array.from(atob(publicKeyPem), c => c.charCodeAt(0));
    
    const publicKey = await crypto.subtle.importKey(
        "spki",
        binaryDer,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["encrypt"]
    );
    
    const encrypted = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        publicKey,
        data
    );
    
    return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

export async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    const keyPair = await crypto.subtle.generateKey(
        { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true,
        ["encrypt", "decrypt"]
    );
    
    const publicKeyBuffer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
    const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    
    return {
        publicKey: btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer))),
        privateKey: btoa(String.fromCharCode(...new Uint8Array(privateKeyBuffer)))
    };
}