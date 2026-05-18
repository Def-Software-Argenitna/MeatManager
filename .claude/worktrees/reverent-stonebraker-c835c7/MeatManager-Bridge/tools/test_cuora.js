const cuora = require('../src/cuora-protocol.js');

const product4 = { current_price: 17500, plu: 4, name: 'TEST 4', id: 4 };
const product2 = { current_price: 22900, plu: 2, name: 'TEST 2', id: 2 };

console.log("Plu 4 encoding defaults:", cuora.buildPlu4Payload(product4));
console.log("Plu 61 encoding defaults:", cuora.buildPlu61Payload(product4));
console.log("Plu 2 encoding defaults:", cuora.buildPlu4Payload(product2));
