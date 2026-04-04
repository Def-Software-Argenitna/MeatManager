const API_KEY = 'AIzaSyCzgv2OrxRrIfmux3BBWe80Um5sukOImEM';

async function main() {
    const email = process.argv[2];
    const password = process.argv[3];
    if (!email || !password) {
        throw new Error('Email y password requeridos');
    }

    const signInRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            password,
            returnSecureToken: true,
        }),
    });

    const signInData = await signInRes.json();
    if (!signInRes.ok) {
        throw new Error(signInData?.error?.message || 'No se pudo autenticar en Firebase');
    }

    const meRes = await fetch('http://127.0.0.1:3001/api/firebase-users/me', {
        headers: {
            Authorization: `Bearer ${signInData.idToken}`,
        },
    });
    const meData = await meRes.json();
    console.log(JSON.stringify({ signInOk: signInRes.ok, meStatus: meRes.status, meData }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
