// Datos del Menú de AsisNexo
// Edita aquí para agregar/quitar productos o cambiar precios.
//
// Campos de cada producto:
// - id         : identificador único (usa el ancla #id en la URL para deep-link).
// - name       : nombre visible.
// - category   : 'alitas' | 'burgers' | 'bebidas' (debe coincidir con un filtro).
// - price      : precio base; null = "Consultar". Si usa variants, usa el de las variantes.
// - desc       : descripción / ingredientes.
// - img        : ruta de la imagen (relativa a la raíz del sitio).
// - variants   : [opcional] selector único (Tamaño Junior/Doble o sabor de bebida).
//                Cada variante: { label, price } (price es el costo extra o el total si base es 0).
// - flavors    : [opcional alitas] sabores con límite máx. { options: [..], max: N }.
// - removable  : [opcional] lista SIN (sin el prefijo "SIN", ej: 'Tocineta').
// - sinPan     : [opcional] true agrega la opción "Sin Pan (envuelta en lechuga)".
// - extras     : lista de adicionales (usa ADICIONALES salvo que el plato tenga una lista propia).
// - popular    : [opcional] true muestra la etiqueta "Popular".

const ADICIONALES = [
    { name: 'Pepinillos', price: 1.00 },
    { name: 'Queso Cheddar', price: 1.00 },
    { name: 'Carne y Queso', price: 2.50 },
    { name: 'Cebolla', price: 0.50 },
    { name: 'Maíz', price: 0.50 },
    { name: 'Cebolla Caramelizada', price: 1.50 },
    { name: 'Queso Americano', price: 1.00 },
    { name: 'Tocineta', price: 1.50 },
    { name: 'Pollo Crispy y Queso', price: 3.00 },
    { name: 'Lechuga', price: 0.50 },
    { name: 'Tomate', price: 0.50 }
];

// Sabores disponibles para los paquetes de alitas.
const SABORES = ['Broaster', 'BBQ Honey', 'Sabor de la Casa', 'Tártara', 'Ajo Parmesano'];

let menuData = [

    // ============ ALITAS ============
    {
        id: 'alitas-chicken-little',
        name: 'Chicken Little',
        category: 'alitas',
        price: 10.00,
        desc: '7 piezas bañadas con 2 sabores de tu elección, papas fritas y arepitas.',
        img: 'img/chicken_little.jpeg',
        flavors: { options: SABORES, max: 2 },
        extras: ADICIONALES,
        popular: true
    },
    {
        id: 'alitas-duo',
        name: 'Dúo',
        category: 'alitas',
        price: 19.00,
        desc: '14 piezas bañadas con 2 sabores de tu elección, papas fritas y arepitas.',
        img: 'img/duo.jpeg',
        flavors: { options: SABORES, max: 2 },
        extras: ADICIONALES
    },
    {
        id: 'alitas-tripack',
        name: 'Tripack',
        category: 'alitas',
        price: 28.00,
        desc: '21 piezas bañadas con 3 sabores de tu elección, papas fritas y arepitas.',
        img: 'img/tripack.jpeg',
        flavors: { options: SABORES, max: 3 },
        extras: ADICIONALES
    },
    {
        id: 'alitas-combo',
        name: 'Combo Alitas',
        category: 'alitas',
        price: 35.00,
        desc: '28 piezas bañadas con 4 sabores de tu elección, papas fritas y arepitas.',
        img: 'img/combo_alitas.jpeg',
        flavors: { options: SABORES, max: 4 },
        extras: ADICIONALES
    },

    // ============ BURGERS ============
    {
        id: 'burger-americana',
        name: 'Americana',
        category: 'burgers',
        price: 0,
        desc: 'Carne premium, slice de queso americano, tocineta ahumada, pepinillos en rodajas, cama de lechuga, tomate fresco y cebolla troceada. Incluye papas fritas.',
        img: 'img/americana.jpeg',
        variants: [
            { label: 'Junior', price: 11.00 },
            { label: 'Doble', price: 13.00 }
        ],
        removable: ['Tocineta', 'Tomate', 'Cebolla', 'Lechuga', 'Pepinillos', 'Salsas', 'Queso'],
        sinPan: true,
        extras: ADICIONALES,
        popular: true
    },
    {
        id: 'burger-cheese',
        name: 'Cheese',
        category: 'burgers',
        price: 0,
        desc: 'Carne premium, slice de queso americano, pepinillos en rodajas y cebolla troceada. Incluye papas fritas.',
        img: 'img/cheese.jpeg',
        variants: [
            { label: 'Junior', price: 8.00 },
            { label: 'Doble', price: 10.00 }
        ],
        removable: ['Queso', 'Salsas', 'Pepinillos', 'Cebolla'],
        sinPan: true,
        extras: ADICIONALES
    },
    {
        id: 'burger-cuarto-de-libra',
        name: 'Cuarto de Libra',
        category: 'burgers',
        price: 0,
        desc: 'Carne premium, slice de queso americano, tocineta ahumada, cama de lechuga, cebolla troceada y pepinillos en rodajas. Incluye papas fritas.',
        img: 'img/cuarto_de_libra.jpeg',
        variants: [
            { label: 'Junior', price: 11.00 },
            { label: 'Doble', price: 13.00 }
        ],
        removable: ['Tocineta', 'Queso', 'Lechuga', 'Cebolla', 'Pepinillos', 'Salsas'],
        sinPan: true,
        extras: ADICIONALES
    },
    {
        id: 'burger-smash',
        name: 'Smash',
        category: 'burgers',
        price: 0,
        desc: 'Carne premium smash, slice de queso americano, tocineta ahumada y cebolla caramelizada. Incluye papas fritas.',
        img: 'img/smash.jpeg',
        variants: [
            { label: 'Junior', price: 11.00 },
            { label: 'Doble', price: 13.00 }
        ],
        removable: ['Tocineta', 'Cebolla Caramelizada', 'Queso', 'Salsas'],
        sinPan: true,
        extras: ADICIONALES
    },
    {
        id: 'burger-especial',
        name: 'Burger Especial',
        category: 'burgers',
        price: 0,
        desc: 'Carne premium, slice de queso americano y mermelada de tocineta. Incluye papas fritas.',
        img: 'img/burger_especial.jpeg',
        variants: [
            { label: 'Junior', price: 11.00 },
            { label: 'Doble', price: 13.00 }
        ],
        removable: ['Salsas'],
        sinPan: true,
        extras: ADICIONALES,
        popular: true
    },
    {
        id: 'burger-crispy',
        name: 'Burger Crispy',
        category: 'burgers',
        price: 13.00,
        desc: 'Pechuga de pollo crispy, slice de queso americano x2, queso cheddar, tocineta ahumada, cama de lechuga y tomate fresco. Incluye papas fritas.',
        img: 'img/burger_crispy.jpeg',
        removable: ['Tocineta', 'Queso', 'Cheddar', 'Lechuga', 'Tomate', 'Salsas'],
        sinPan: true,
        extras: ADICIONALES,
        popular: true
    },

    // ============ BEBIDAS ============
    {
        id: 'bebida-agua',
        name: 'Agua 600ml',
        category: 'bebidas',
        price: 1.50,
        desc: 'Agua mineral 600 ml.',
        img: 'img/agua_600ml.webp',
        extras: []
    },
    {
        id: 'bebida-bombita',
        name: 'Bombita',
        category: 'bebidas',
        price: 1.50,
        desc: 'Refresco en presentación bombita.',
        img: 'img/bombita.webp',
        variants: [
            { label: 'Coca-Cola', price: 0 },
            { label: 'Frescolita', price: 0 }
        ],
        variantTitle: 'Elige tu Bebida',
        extras: []
    },
    {
        id: 'bebida-nestea',
        name: 'Nestea',
        category: 'bebidas',
        price: 2.00,
        desc: 'Nestea 500 ml. Próximamente para llevar.',
        img: 'img/placeholder.svg',
        extras: []
    },
    {
        id: 'bebida-refresco-1l',
        name: 'Refresco 1L',
        category: 'bebidas',
        price: 2.50,
        desc: 'Refresco familiar de 1 litro.',
        img: 'img/refresco_de_1l.webp',
        variants: [
            { label: 'Coca-Cola', price: 0 },
            { label: 'Frescolita', price: 0 },
            { label: 'Chinotto', price: 0 }
        ],
        variantTitle: 'Elige tu Bebida',
        extras: []
    },
    {
        id: 'bebida-refresco-1-5l',
        name: 'Refresco 1.5L',
        category: 'bebidas',
        price: 3.00,
        desc: 'Refresco familiar de 1.5 litros.',
        img: 'img/refresco_de_1_5l.webp',
        variants: [
            { label: 'Coca-Cola', price: 0 },
            { label: 'Chinotto', price: 0 },
            { label: 'Naranja', price: 0 },
            { label: 'Uva', price: 0 }
        ],
        variantTitle: 'Elige tu Bebida',
        extras: []
    },
    {
        id: 'bebida-refresco-2l',
        name: 'Refresco 2L',
        category: 'bebidas',
        price: 3.50,
        desc: 'Refresco familiar de 2 litros.',
        img: 'img/refresco_de_2l.jpeg',
        variants: [
            { label: 'Coca-Cola', price: 0 },
            { label: 'Uva', price: 0 },
            { label: 'Chinotto', price: 0 }
        ],
        variantTitle: 'Elige tu Bebida',
        extras: []
    },
    {
        id: 'bebida-refresco-lata',
        name: 'Refresco Lata',
        category: 'bebidas',
        price: 2.00,
        desc: 'Refresco en lata 355 ml.',
        img: 'img/refresco_lata.png',
        variants: [
            { label: 'Coca-Cola', price: 0 },
            { label: 'Frescolita', price: 0 },
            { label: 'Chinotto', price: 0 }
        ],
        variantTitle: 'Elige tu Bebida',
        extras: []
    },
    {
        id: 'bebida-yucky-pack',
        name: 'Yucky Pack',
        category: 'bebidas',
        price: 2.00,
        desc: 'Jugo en presentación individual.',
        img: 'img/yucky_pack.webp',
        variants: [
            { label: 'Manzana', price: 0 },
            { label: 'Pera', price: 0 }
        ],
        variantTitle: 'Elige tu Bebida',
        extras: []
    }
];