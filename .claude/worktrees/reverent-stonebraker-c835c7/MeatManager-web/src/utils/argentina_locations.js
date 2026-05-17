export const PROVINCES = [
    "Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos",
    "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro",
    "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero",
    "Tierra del Fuego", "Tucumán"
];

// Major cities by province (representative list to avoid massive file)
export const MAJOR_CITIES = {
    "Buenos Aires": ["La Plata", "Mar del Plata", "Bahía Blanca", "Pilar", "Luján", "San Nicolás", "Tandil", "Junín", "Olavarría", "Pergamino"],
    "CABA": ["CABA"],
    "Córdoba": ["Córdoba Capital", "Villa Carlos Paz", "Río Cuarto", "Villa María", "San Francisco", "Alta Gracia"],
    "Santa Fe": ["Rosario", "Santa Fe Capital", "Rafaela", "Venado Tuerto", "Santo Tomé"],
    "Mendoza": ["Mendoza Capital", "San Rafael", "Godoy Cruz", "Maipú", "Luján de Cuyo"],
    "Tucumán": ["San Miguel de Tucumán", "Yerba Buena", "Tafí Viejo", "Concepción"],
    "Salta": ["Salta Capital", "San Ramón de la Nueva Orán", "Tartagal"],
    "Entre Ríos": ["Paraná", "Concordia", "Gualeguaychú", "Concepción del Uruguay"],
    "Misiones": ["Posadas", "Eldorado", "Oberá"],
    "Chaco": ["Resistencia", "Presidencia Roque Sáenz Peña", "Villa Ángela"],
    "Corrientes": ["Corrientes Capital", "Goya", "Paso de los Libres"],
    "Santiago del Estero": ["Santiago del Estero Capital", "La Banda", "Termas de Río Hondo"],
    "San Juan": ["San Juan Capital", "Rawson", "Chimbas"],
    "Jujuy": ["San Salvador de Jujuy", "San Pedro de Jujuy", "Palpalá"],
    "Río Negro": ["Viedma", "Bariloche", "General Roca", "Cipolletti"],
    "Neuquén": ["Neuquén Capital", "Cutral Có", "Centenario", "Plottier"],
    "Formosa": ["Formosa Capital", "Clorinda"],
    "Chubut": ["Rawson", "Comodoro Rivadavia", "Trelew", "Puerto Madryn"],
    "San Luis": ["San Luis Capital", "Villa Mercedes"],
    "Catamarca": ["San Fernando del Valle de Catamarca"],
    "La Rioja": ["La Rioja Capital", "Chilecito"],
    "La Pampa": ["Santa Rosa", "General Pico"],
    "Santa Cruz": ["Río Gallegos", "Caleta Olivia"],
    "Tierra del Fuego": ["Ushuaia", "Río Grande", "Tolhuin"]
};

// Barrios are way too many to pre-load for the whole country.
// We will focus on some common ones or allow free-text with autocomplete from used ones.
