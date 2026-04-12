import React from 'react';
import DespostadaBase from '../components/despostada/DespostadaBase';
import { CERDO_CUTS } from './despostadaData';

const DespostadaCerdo = () => (
    <DespostadaBase
        species="cerdo"
        title="Despostada Cerdo"
        subtitle="Una cabina premium para dividir piezas, medir rendimiento y dejar cada lote listo para stock y costos."
        heroImage="/cerdo_argentino.png"
        cutMap={CERDO_CUTS}
        lotSpecies="cerdo"
        lotLabel="Cerdo disponible"
        lotEmptyLabel="-- No hay cerdos disponibles --"
        lotPlaceholderLabel="-- Seleccionar cerdo o ingresar peso manual --"
        manualHint="Recordá registrar la compra del cerdo para que aparezca acá."
        noWeightMessage="Por favor ingresá el peso inicial o seleccioná un cerdo de stock."
        finishConfirm="¿Finalizar esta despostada de cerdo?"
        finishSuccess="Despostada finalizada con éxito."
        lockedDescription="La despostada se habilita desde Gestión de Clientes, no por código local."
        lockedCtaLabel="Ver estado de licencias"
        purchaseHints={['cerdo', 'pork']}
        accent="#fb7185"
    />
);

export default DespostadaCerdo;
