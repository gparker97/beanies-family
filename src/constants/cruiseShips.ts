export interface CruiseShipInfo {
  name: string; // Ship name (e.g., 'Symphony of the Seas')
  cruiseLine: string; // Parent cruise line (e.g., 'Royal Caribbean International')
}

export const CRUISE_SHIPS: CruiseShipInfo[] = [
  // AIDA Cruises
  { name: 'AIDAcosma', cruiseLine: 'AIDA Cruises' },
  { name: 'AIDAnova', cruiseLine: 'AIDA Cruises' },
  { name: 'AIDAprima', cruiseLine: 'AIDA Cruises' },

  // Azamara
  { name: 'Azamara Journey', cruiseLine: 'Azamara' },
  { name: 'Azamara Onward', cruiseLine: 'Azamara' },
  { name: 'Azamara Pursuit', cruiseLine: 'Azamara' },
  { name: 'Azamara Quest', cruiseLine: 'Azamara' },

  // Carnival Cruise Line
  { name: 'Carnival Breeze', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Celebration', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Conquest', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Dream', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Elation', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Firenze', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Freedom', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Glory', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Horizon', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Jubilee', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Legend', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Liberty', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Luminosa', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Magic', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Miracle', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Panorama', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Paradise', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Pride', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Radiance', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Spirit', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Splendor', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Sunrise', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Sunshine', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Valor', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Venezia', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Carnival Vista', cruiseLine: 'Carnival Cruise Line' },
  { name: 'Mardi Gras', cruiseLine: 'Carnival Cruise Line' },

  // Celebrity Cruises
  { name: 'Celebrity Apex', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Ascent', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Beyond', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Constellation', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Eclipse', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Edge', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Equinox', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Infinity', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Millennium', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Reflection', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Silhouette', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Solstice', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Summit', cruiseLine: 'Celebrity Cruises' },
  { name: 'Celebrity Xcel', cruiseLine: 'Celebrity Cruises' },

  // Costa Cruises
  { name: 'Costa Deliziosa', cruiseLine: 'Costa Cruises' },
  { name: 'Costa Diadema', cruiseLine: 'Costa Cruises' },
  { name: 'Costa Fascinosa', cruiseLine: 'Costa Cruises' },
  { name: 'Costa Favolosa', cruiseLine: 'Costa Cruises' },
  { name: 'Costa Fortuna', cruiseLine: 'Costa Cruises' },
  { name: 'Costa Pacifica', cruiseLine: 'Costa Cruises' },
  { name: 'Costa Smeralda', cruiseLine: 'Costa Cruises' },
  { name: 'Costa Toscana', cruiseLine: 'Costa Cruises' },

  // Crystal Cruises
  { name: 'Crystal Serenity', cruiseLine: 'Crystal Cruises' },
  { name: 'Crystal Symphony', cruiseLine: 'Crystal Cruises' },

  // Cunard
  { name: 'Queen Anne', cruiseLine: 'Cunard' },
  { name: 'Queen Elizabeth', cruiseLine: 'Cunard' },
  { name: 'Queen Mary 2', cruiseLine: 'Cunard' },
  { name: 'Queen Victoria', cruiseLine: 'Cunard' },

  // Disney Cruise Line
  { name: 'Disney Adventure', cruiseLine: 'Disney Cruise Line' },
  { name: 'Disney Dream', cruiseLine: 'Disney Cruise Line' },
  { name: 'Disney Fantasy', cruiseLine: 'Disney Cruise Line' },
  { name: 'Disney Magic', cruiseLine: 'Disney Cruise Line' },
  { name: 'Disney Treasure', cruiseLine: 'Disney Cruise Line' },
  { name: 'Disney Wish', cruiseLine: 'Disney Cruise Line' },
  { name: 'Disney Wonder', cruiseLine: 'Disney Cruise Line' },

  // Explora Journeys
  { name: 'Explora I', cruiseLine: 'Explora Journeys' },
  { name: 'Explora II', cruiseLine: 'Explora Journeys' },

  // Fred. Olsen Cruise Lines
  { name: 'Bolette', cruiseLine: 'Fred. Olsen Cruise Lines' },
  { name: 'Borealis', cruiseLine: 'Fred. Olsen Cruise Lines' },

  // Holland America Line
  { name: 'Eurodam', cruiseLine: 'Holland America Line' },
  { name: 'Koningsdam', cruiseLine: 'Holland America Line' },
  { name: 'Nieuw Amsterdam', cruiseLine: 'Holland America Line' },
  { name: 'Nieuw Statendam', cruiseLine: 'Holland America Line' },
  { name: 'Noordam', cruiseLine: 'Holland America Line' },
  { name: 'Oosterdam', cruiseLine: 'Holland America Line' },
  { name: 'Rotterdam', cruiseLine: 'Holland America Line' },
  { name: 'Volendam', cruiseLine: 'Holland America Line' },
  { name: 'Westerdam', cruiseLine: 'Holland America Line' },
  { name: 'Zaandam', cruiseLine: 'Holland America Line' },
  { name: 'Zuiderdam', cruiseLine: 'Holland America Line' },

  // Hurtigruten
  { name: 'MS Fridtjof Nansen', cruiseLine: 'Hurtigruten' },
  { name: 'MS Roald Amundsen', cruiseLine: 'Hurtigruten' },

  // MSC Cruises
  { name: 'MSC Armonia', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Bellissima', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Divina', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Euribia', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Fantasia', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Grandiosa', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Lirica', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Magnifica', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Meraviglia', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Musica', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Opera', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Orchestra', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Poesia', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Preziosa', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Seascape', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Seashore', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Seaview', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Sinfonia', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Splendida', cruiseLine: 'MSC Cruises' },
  { name: 'MSC Virtuosa', cruiseLine: 'MSC Cruises' },
  { name: 'MSC World America', cruiseLine: 'MSC Cruises' },
  { name: 'MSC World Europa', cruiseLine: 'MSC Cruises' },

  // Norwegian Cruise Line
  { name: 'Norwegian Bliss', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Breakaway', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Dawn', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Encore', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Epic', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Escape', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Gem', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Getaway', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Jade', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Jewel', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Joy', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Pearl', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Prima', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Sky', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Spirit', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Star', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Sun', cruiseLine: 'Norwegian Cruise Line' },
  { name: 'Norwegian Viva', cruiseLine: 'Norwegian Cruise Line' },

  // Oceania Cruises
  { name: 'Marina', cruiseLine: 'Oceania Cruises' },
  { name: 'Nautica', cruiseLine: 'Oceania Cruises' },
  { name: 'Regatta', cruiseLine: 'Oceania Cruises' },
  { name: 'Riviera', cruiseLine: 'Oceania Cruises' },
  { name: 'Sirena', cruiseLine: 'Oceania Cruises' },
  { name: 'Vista', cruiseLine: 'Oceania Cruises' },

  // P&O Cruises
  { name: 'Arcadia', cruiseLine: 'P&O Cruises' },
  { name: 'Arvia', cruiseLine: 'P&O Cruises' },
  { name: 'Aurora', cruiseLine: 'P&O Cruises' },
  { name: 'Azura', cruiseLine: 'P&O Cruises' },
  { name: 'Britannia', cruiseLine: 'P&O Cruises' },
  { name: 'Iona', cruiseLine: 'P&O Cruises' },
  { name: 'Ventura', cruiseLine: 'P&O Cruises' },

  // P&O Cruises Australia
  { name: 'Pacific Adventure', cruiseLine: 'P&O Cruises Australia' },
  { name: 'Pacific Encounter', cruiseLine: 'P&O Cruises Australia' },
  { name: 'Pacific Explorer', cruiseLine: 'P&O Cruises Australia' },

  // Ponant
  { name: 'Le Commandant Charcot', cruiseLine: 'Ponant' },
  { name: 'Le Jacques Cartier', cruiseLine: 'Ponant' },
  { name: 'Le Ponant', cruiseLine: 'Ponant' },

  // Princess Cruises
  { name: 'Caribbean Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Coral Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Crown Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Diamond Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Discovery Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Emerald Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Enchanted Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Grand Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Island Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Majestic Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Regal Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Royal Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Ruby Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Sapphire Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Sky Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Star Princess', cruiseLine: 'Princess Cruises' },
  { name: 'Sun Princess', cruiseLine: 'Princess Cruises' },

  // Regent Seven Seas Cruises
  { name: 'Seven Seas Explorer', cruiseLine: 'Regent Seven Seas Cruises' },
  { name: 'Seven Seas Grandeur', cruiseLine: 'Regent Seven Seas Cruises' },
  { name: 'Seven Seas Mariner', cruiseLine: 'Regent Seven Seas Cruises' },
  { name: 'Seven Seas Navigator', cruiseLine: 'Regent Seven Seas Cruises' },
  { name: 'Seven Seas Splendor', cruiseLine: 'Regent Seven Seas Cruises' },
  { name: 'Seven Seas Voyager', cruiseLine: 'Regent Seven Seas Cruises' },

  // Ritz-Carlton Yacht Collection
  { name: 'Evrima', cruiseLine: 'Ritz-Carlton Yacht Collection' },
  { name: 'Ilma', cruiseLine: 'Ritz-Carlton Yacht Collection' },

  // Royal Caribbean International
  { name: 'Adventure of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Allure of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Anthem of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Brilliance of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Explorer of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Freedom of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Grandeur of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Harmony of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Icon of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Independence of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Jewel of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Liberty of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Mariner of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Navigator of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Oasis of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Odyssey of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Ovation of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Quantum of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Radiance of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Rhapsody of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Serenade of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Spectrum of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Star of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Symphony of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Utopia of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Vision of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Voyager of the Seas', cruiseLine: 'Royal Caribbean International' },
  { name: 'Wonder of the Seas', cruiseLine: 'Royal Caribbean International' },

  // Seabourn
  { name: 'Seabourn Encore', cruiseLine: 'Seabourn' },
  { name: 'Seabourn Ovation', cruiseLine: 'Seabourn' },
  { name: 'Seabourn Pursuit', cruiseLine: 'Seabourn' },
  { name: 'Seabourn Quest', cruiseLine: 'Seabourn' },
  { name: 'Seabourn Sojourn', cruiseLine: 'Seabourn' },
  { name: 'Seabourn Venture', cruiseLine: 'Seabourn' },

  // Silversea Cruises
  { name: 'Silver Cloud', cruiseLine: 'Silversea Cruises' },
  { name: 'Silver Dawn', cruiseLine: 'Silversea Cruises' },
  { name: 'Silver Endeavour', cruiseLine: 'Silversea Cruises' },
  { name: 'Silver Moon', cruiseLine: 'Silversea Cruises' },
  { name: 'Silver Muse', cruiseLine: 'Silversea Cruises' },
  { name: 'Silver Nova', cruiseLine: 'Silversea Cruises' },
  { name: 'Silver Ray', cruiseLine: 'Silversea Cruises' },
  { name: 'Silver Shadow', cruiseLine: 'Silversea Cruises' },
  { name: 'Silver Spirit', cruiseLine: 'Silversea Cruises' },
  { name: 'Silver Whisper', cruiseLine: 'Silversea Cruises' },
  { name: 'Silver Wind', cruiseLine: 'Silversea Cruises' },

  // TUI Cruises
  { name: 'Mein Schiff 1', cruiseLine: 'TUI Cruises' },
  { name: 'Mein Schiff 2', cruiseLine: 'TUI Cruises' },
  { name: 'Mein Schiff 3', cruiseLine: 'TUI Cruises' },
  { name: 'Mein Schiff 4', cruiseLine: 'TUI Cruises' },
  { name: 'Mein Schiff 5', cruiseLine: 'TUI Cruises' },
  { name: 'Mein Schiff 6', cruiseLine: 'TUI Cruises' },
  { name: 'Mein Schiff 7', cruiseLine: 'TUI Cruises' },

  // Viking Ocean Cruises
  { name: 'Viking Jupiter', cruiseLine: 'Viking Ocean Cruises' },
  { name: 'Viking Mars', cruiseLine: 'Viking Ocean Cruises' },
  { name: 'Viking Neptune', cruiseLine: 'Viking Ocean Cruises' },
  { name: 'Viking Orion', cruiseLine: 'Viking Ocean Cruises' },
  { name: 'Viking Saturn', cruiseLine: 'Viking Ocean Cruises' },
  { name: 'Viking Sea', cruiseLine: 'Viking Ocean Cruises' },
  { name: 'Viking Sky', cruiseLine: 'Viking Ocean Cruises' },
  { name: 'Viking Star', cruiseLine: 'Viking Ocean Cruises' },
  { name: 'Viking Venus', cruiseLine: 'Viking Ocean Cruises' },
  { name: 'Viking Vela', cruiseLine: 'Viking Ocean Cruises' },

  // Virgin Voyages
  { name: 'Brilliant Lady', cruiseLine: 'Virgin Voyages' },
  { name: 'Resilient Lady', cruiseLine: 'Virgin Voyages' },
  { name: 'Scarlet Lady', cruiseLine: 'Virgin Voyages' },
  { name: 'Valiant Lady', cruiseLine: 'Virgin Voyages' },

  // Windstar Cruises
  { name: 'Star Breeze', cruiseLine: 'Windstar Cruises' },
  { name: 'Star Legend', cruiseLine: 'Windstar Cruises' },
  { name: 'Star Pride', cruiseLine: 'Windstar Cruises' },
  { name: 'Wind Spirit', cruiseLine: 'Windstar Cruises' },
  { name: 'Wind Star', cruiseLine: 'Windstar Cruises' },
  { name: 'Wind Surf', cruiseLine: 'Windstar Cruises' },
];

/**
 * Get unique cruise line names, sorted alphabetically
 */
export function getCruiseLineNames(): string[] {
  const lines = new Set(CRUISE_SHIPS.map((s) => s.cruiseLine));
  return [...lines].sort();
}

/**
 * Get ships for a specific cruise line, sorted by name
 */
export function getShipsByCruiseLine(cruiseLine: string): CruiseShipInfo[] {
  return CRUISE_SHIPS.filter((s) => s.cruiseLine === cruiseLine).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

/**
 * Search ships by name (case-insensitive partial match)
 */
export function searchCruiseShips(query: string): CruiseShipInfo[] {
  const q = query.toLowerCase();
  return CRUISE_SHIPS.filter(
    (s) => s.name.toLowerCase().includes(q) || s.cruiseLine.toLowerCase().includes(q)
  );
}
