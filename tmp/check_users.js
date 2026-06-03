const mysql = require('mysql2/promise');

async function checkUsers() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      multipleStatements: true
    });

    // Buscar clientes Fatima y Pilar
    const [clients] = await conn.query(`
      SELECT id, businessName, billingEmail, taxId, status
      FROM clients_control.clients
      WHERE LOWER(businessName) LIKE '%fatima%' OR LOWER(businessName) LIKE '%pilar%'
      ORDER BY businessName
    `);

    console.log('\n========== CLIENTES ENCONTRADOS ==========');
    clients.forEach(c => {
      console.log(`ID: ${c.id} | ${c.businessName} | Email: ${c.billingEmail} | Estado: ${c.status}`);
    });

    if (clients.length === 0) {
      console.log('No se encontraron clientes con esos nombres');
      return;
    }

    // Buscar usuarios de esos clientes
    const clientIds = clients.map(c => c.id);
    const [users] = await conn.query(`
      SELECT 
        cu.id,
        cu.clientId,
        cu.branchId,
        cu.name,
        cu.lastname,
        cu.email,
        cu.role,
        cu.status,
        c.businessName AS clientName,
        b.name AS branchName
      FROM clients_control.client_users cu
      INNER JOIN clients_control.clients c ON c.id = cu.clientId
      LEFT JOIN clients_control.client_branches b ON b.id = cu.branchId AND b.clientId = cu.clientId
      WHERE cu.clientId IN (?)
      ORDER BY c.businessName, cu.id
    `, [clientIds]);

    console.log('\n========== USUARIOS POR CLIENTE ==========');
    let currentClient = null;
    users.forEach(u => {
      if (currentClient !== u.clientName) {
        currentClient = u.clientName;
        console.log(`\n📍 ${currentClient}:`);
      }
      const fullName = [u.name, u.lastname].filter(Boolean).join(' ') || 'Sin nombre';
      const branch = u.branchName ? ` | Sucursal: ${u.branchName}` : ' | Sin sucursal';
      console.log(`  - ID: ${u.id} | ${fullName} | Email: ${u.email} | Role: ${u.role} | Estado: ${u.status}${branch}`);
    });

    console.log(`\n\nTOTAL: ${users.length} usuario(s) encontrado(s)`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n⚠️  MySQL no está corriendo o no es accesible en localhost');
    }
  } finally {
    if (conn) await conn.end();
  }
}

checkUsers();
