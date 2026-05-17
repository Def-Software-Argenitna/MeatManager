// Script de uso único — se borra después de ejecutar
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const admin = require('firebase-admin');

const serviceAccount = require(path.join(__dirname, 'firebase-service-account.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const EMAIL    = 'admin@admion.com';
const PASSWORD = 'admin123'; // Firebase requiere mín 6 chars — se puede cambiar luego
const CUIT     = '20992311231';
const EMPRESA  = 'Def-Software';
const PLAN     = 'pro';

(async () => {
    try {
        // 1. Crear usuario en Firebase Auth
        let user;
        try {
            user = await admin.auth().createUser({ email: EMAIL, password: PASSWORD });
            console.log('✅ Usuario Firebase creado:', user.uid);
        } catch (e) {
            if (e.code === 'auth/email-already-exists') {
                user = await admin.auth().getUserByEmail(EMAIL);
                console.log('⚠️  Usuario ya existía, usando UID:', user.uid);
            } else {
                throw e;
            }
        }

        // 2. Crear documento en Firestore clientes/{uid}
        await admin.firestore().collection('clientes').doc(user.uid).set({
            cuit:    CUIT,
            empresa: EMPRESA,
            email:   EMAIL,
            activo:  true,
            plan:    PLAN,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        console.log('✅ Documento Firestore creado en clientes/' + user.uid);
        console.log('');
        console.log('── Resumen ──────────────────────────────────');
        console.log('   Email:   ', EMAIL);
        console.log('   CUIT:    ', CUIT);
        console.log('   Empresa: ', EMPRESA);
        console.log('   UID:     ', user.uid);
        console.log('   BD MySQL: mm_' + CUIT);
        console.log('── CAMBIÁ LA CONTRASEÑA después del primer login ──');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        process.exit(0);
    }
})();
