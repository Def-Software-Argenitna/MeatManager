import React from 'react';
import DespostadaBase from '../components/despostada/DespostadaBase';
import { PESCADO_CUTS } from './despostadaData';

const DespostadaPescado = () => (
    <DespostadaBase
        species="pescado"
        title="Despostada Pescado"
        subtitle="Un flujo limpio para filetear, registrar peso real y dejar el rinde documentado con trazabilidad pro."
        heroImage="/pescado_argentino.png"
        cutMap={PESCADO_CUTS}
        lotSpecies="pescado"
        lotLabel="Pescado disponible"
        lotEmptyLabel="-- No hay pescado disponible --"
        lotPlaceholderLabel="-- Seleccionar pescado o ingresar peso manual --"
        manualHint="Recordá registrar la compra del pescado para que aparezca acá."
        noWeightMessage="Por favor ingresá el peso inicial o seleccioná una pieza de pescado de stock."
        finishConfirm="¿Finalizar procesamiento de pescado?"
        finishSuccess="Proceso finalizado."
        lockedDescription="La despostada se habilita desde Gestión de Clientes, no por código local."
        lockedCtaLabel="Ver estado de licencias"
        purchaseHints={['pescado', 'fish']}
        accent="#38bdf8"
    />
);

export default DespostadaPescado;
