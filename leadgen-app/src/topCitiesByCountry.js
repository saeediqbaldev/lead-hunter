// Top cities (roughly by population/economic significance) for the 30
// countries the daily automation supports. Hand-curated from general
// geographic knowledge, not copied from any third-party compiled
// dataset - avoids any question about reusing someone else's licensed
// compilation. A handful of small nations (Singapore, UAE, Luxembourg)
// don't have 20 genuinely distinct major cities, so those lists are
// intentionally shorter rather than padded with places that aren't
// meaningfully separate search targets.
//
// Each entry is formatted exactly as it should be passed to the search
// route's "location" field - "City, Country".

const TOP_CITIES_BY_COUNTRY = {
  "United States": [
    "New York, United States", "Los Angeles, United States", "Chicago, United States", "Houston, United States",
    "Phoenix, United States", "Philadelphia, United States", "San Antonio, United States", "San Diego, United States",
    "Dallas, United States", "San Jose, United States", "Austin, United States", "Jacksonville, United States",
    "Fort Worth, United States", "Columbus, United States", "Charlotte, United States", "San Francisco, United States",
    "Indianapolis, United States", "Seattle, United States", "Denver, United States", "Washington, United States",
  ],
  "Australia": [
    "Sydney, Australia", "Melbourne, Australia", "Brisbane, Australia", "Perth, Australia", "Adelaide, Australia",
    "Gold Coast, Australia", "Newcastle, Australia", "Canberra, Australia", "Sunshine Coast, Australia", "Wollongong, Australia",
    "Hobart, Australia", "Geelong, Australia", "Townsville, Australia", "Cairns, Australia", "Darwin, Australia",
    "Toowoomba, Australia", "Ballarat, Australia", "Bendigo, Australia", "Albury, Australia", "Launceston, Australia",
  ],
  "Canada": [
    "Toronto, Canada", "Montreal, Canada", "Vancouver, Canada", "Calgary, Canada", "Edmonton, Canada",
    "Ottawa, Canada", "Winnipeg, Canada", "Quebec City, Canada", "Hamilton, Canada", "Kitchener, Canada",
    "London, Canada", "Victoria, Canada", "Halifax, Canada", "Oshawa, Canada", "Windsor, Canada",
    "Saskatoon, Canada", "Regina, Canada", "St. Catharines, Canada", "Barrie, Canada", "Kelowna, Canada",
  ],
  "United Kingdom": [
    "London, United Kingdom", "Birmingham, United Kingdom", "Manchester, United Kingdom", "Glasgow, United Kingdom",
    "Liverpool, United Kingdom", "Leeds, United Kingdom", "Sheffield, United Kingdom", "Edinburgh, United Kingdom",
    "Bristol, United Kingdom", "Cardiff, United Kingdom", "Leicester, United Kingdom", "Coventry, United Kingdom",
    "Belfast, United Kingdom", "Nottingham, United Kingdom", "Newcastle, United Kingdom", "Southampton, United Kingdom",
    "Portsmouth, United Kingdom", "Aberdeen, United Kingdom", "Oxford, United Kingdom", "Cambridge, United Kingdom",
  ],
  "Germany": [
    "Berlin, Germany", "Hamburg, Germany", "Munich, Germany", "Cologne, Germany", "Frankfurt, Germany",
    "Stuttgart, Germany", "Dusseldorf, Germany", "Dortmund, Germany", "Essen, Germany", "Leipzig, Germany",
    "Bremen, Germany", "Dresden, Germany", "Hannover, Germany", "Nuremberg, Germany", "Duisburg, Germany",
    "Bochum, Germany", "Wuppertal, Germany", "Bielefeld, Germany", "Bonn, Germany", "Mannheim, Germany",
  ],
  "Netherlands": [
    "Amsterdam, Netherlands", "Rotterdam, Netherlands", "The Hague, Netherlands", "Utrecht, Netherlands",
    "Eindhoven, Netherlands", "Tilburg, Netherlands", "Groningen, Netherlands", "Almere, Netherlands",
    "Breda, Netherlands", "Nijmegen, Netherlands", "Enschede, Netherlands", "Haarlem, Netherlands",
    "Arnhem, Netherlands", "Zaanstad, Netherlands", "Amersfoort, Netherlands", "Apeldoorn, Netherlands",
    "Den Bosch, Netherlands", "Hoofddorp, Netherlands", "Maastricht, Netherlands", "Leiden, Netherlands",
  ],
  "New Zealand": [
    "Auckland, New Zealand", "Wellington, New Zealand", "Christchurch, New Zealand", "Hamilton, New Zealand",
    "Tauranga, New Zealand", "Napier, New Zealand", "Dunedin, New Zealand", "Palmerston North, New Zealand",
    "Nelson, New Zealand", "Rotorua, New Zealand", "New Plymouth, New Zealand", "Whangarei, New Zealand",
    "Invercargill, New Zealand", "Whanganui, New Zealand", "Gisborne, New Zealand", "Timaru, New Zealand",
    "Taupo, New Zealand", "Masterton, New Zealand",
  ],
  "Ireland": [
    "Dublin, Ireland", "Cork, Ireland", "Limerick, Ireland", "Galway, Ireland", "Waterford, Ireland",
    "Drogheda, Ireland", "Swords, Ireland", "Dundalk, Ireland", "Bray, Ireland", "Navan, Ireland",
    "Kilkenny, Ireland", "Ennis, Ireland", "Carlow, Ireland", "Tralee, Ireland", "Newbridge, Ireland",
    "Portlaoise, Ireland", "Naas, Ireland", "Athlone, Ireland", "Mullingar, Ireland", "Wexford, Ireland",
  ],
  "France": [
    "Paris, France", "Marseille, France", "Lyon, France", "Toulouse, France", "Nice, France",
    "Nantes, France", "Strasbourg, France", "Montpellier, France", "Bordeaux, France", "Lille, France",
    "Rennes, France", "Reims, France", "Le Havre, France", "Saint-Etienne, France", "Toulon, France",
    "Grenoble, France", "Dijon, France", "Angers, France", "Nimes, France", "Villeurbanne, France",
  ],
  "Switzerland": [
    "Zurich, Switzerland", "Geneva, Switzerland", "Basel, Switzerland", "Lausanne, Switzerland", "Bern, Switzerland",
    "Winterthur, Switzerland", "Lucerne, Switzerland", "St. Gallen, Switzerland", "Lugano, Switzerland", "Biel, Switzerland",
    "Thun, Switzerland", "Koniz, Switzerland", "Fribourg, Switzerland", "Schaffhausen, Switzerland", "Chur, Switzerland",
    "Vernier, Switzerland", "Neuchatel, Switzerland", "Uster, Switzerland", "Sion, Switzerland", "Zug, Switzerland",
  ],
  "Sweden": [
    "Stockholm, Sweden", "Gothenburg, Sweden", "Malmo, Sweden", "Uppsala, Sweden", "Vasteras, Sweden",
    "Orebro, Sweden", "Linkoping, Sweden", "Helsingborg, Sweden", "Jonkoping, Sweden", "Norrkoping, Sweden",
    "Lund, Sweden", "Umea, Sweden", "Gavle, Sweden", "Boras, Sweden", "Sodertalje, Sweden",
    "Eskilstuna, Sweden", "Halmstad, Sweden", "Vaxjo, Sweden", "Karlstad, Sweden", "Sundsvall, Sweden",
  ],
  "Denmark": [
    "Copenhagen, Denmark", "Aarhus, Denmark", "Odense, Denmark", "Aalborg, Denmark", "Esbjerg, Denmark",
    "Randers, Denmark", "Kolding, Denmark", "Horsens, Denmark", "Vejle, Denmark", "Roskilde, Denmark",
    "Herning, Denmark", "Silkeborg, Denmark", "Naestved, Denmark", "Fredericia, Denmark", "Viborg, Denmark",
    "Koge, Denmark", "Holstebro, Denmark", "Slagelse, Denmark", "Hillerod, Denmark", "Sonderborg, Denmark",
  ],
  "Norway": [
    "Oslo, Norway", "Bergen, Norway", "Trondheim, Norway", "Stavanger, Norway", "Baerum, Norway",
    "Kristiansand, Norway", "Fredrikstad, Norway", "Sandnes, Norway", "Tromso, Norway", "Sarpsborg, Norway",
    "Skien, Norway", "Alesund, Norway", "Sandefjord, Norway", "Haugesund, Norway", "Tonsberg, Norway",
    "Moss, Norway", "Porsgrunn, Norway", "Bodo, Norway", "Arendal, Norway", "Hamar, Norway",
  ],
  "Austria": [
    "Vienna, Austria", "Graz, Austria", "Linz, Austria", "Salzburg, Austria", "Innsbruck, Austria",
    "Klagenfurt, Austria", "Villach, Austria", "Wels, Austria", "Sankt Polten, Austria", "Dornbirn, Austria",
    "Wiener Neustadt, Austria", "Steyr, Austria", "Feldkirch, Austria", "Bregenz, Austria", "Leonding, Austria",
    "Klosterneuburg, Austria", "Baden, Austria", "Wolfsberg, Austria", "Leoben, Austria", "Krems, Austria",
  ],
  "Belgium": [
    "Brussels, Belgium", "Antwerp, Belgium", "Ghent, Belgium", "Charleroi, Belgium", "Liege, Belgium",
    "Bruges, Belgium", "Namur, Belgium", "Leuven, Belgium", "Mons, Belgium", "Aalst, Belgium",
    "Mechelen, Belgium", "La Louviere, Belgium", "Kortrijk, Belgium", "Hasselt, Belgium", "Sint-Niklaas, Belgium",
    "Ostend, Belgium", "Tournai, Belgium", "Genk, Belgium", "Seraing, Belgium", "Roeselare, Belgium",
  ],
  "Singapore": ["Singapore"],
  "United Arab Emirates": [
    "Dubai, United Arab Emirates", "Abu Dhabi, United Arab Emirates", "Sharjah, United Arab Emirates",
    "Al Ain, United Arab Emirates", "Ajman, United Arab Emirates", "Ras Al Khaimah, United Arab Emirates",
    "Fujairah, United Arab Emirates", "Umm Al Quwain, United Arab Emirates",
  ],
  "South Africa": [
    "Johannesburg, South Africa", "Cape Town, South Africa", "Durban, South Africa", "Pretoria, South Africa",
    "Gqeberha, South Africa", "Bloemfontein, South Africa", "East London, South Africa", "Pietermaritzburg, South Africa",
    "Mbombela, South Africa", "Kimberley, South Africa", "Polokwane, South Africa", "Rustenburg, South Africa",
    "George, South Africa", "Vereeniging, South Africa", "Welkom, South Africa", "Klerksdorp, South Africa",
    "Potchefstroom, South Africa", "Witbank, South Africa", "Newcastle, South Africa", "Springs, South Africa",
  ],
  "Spain": [
    "Madrid, Spain", "Barcelona, Spain", "Valencia, Spain", "Seville, Spain", "Zaragoza, Spain",
    "Malaga, Spain", "Murcia, Spain", "Palma, Spain", "Las Palmas, Spain", "Bilbao, Spain",
    "Alicante, Spain", "Cordoba, Spain", "Valladolid, Spain", "Vigo, Spain", "Gijon, Spain",
    "L'Hospitalet de Llobregat, Spain", "Vitoria-Gasteiz, Spain", "Granada, Spain", "Elche, Spain", "Oviedo, Spain",
  ],
  "Portugal": [
    "Lisbon, Portugal", "Porto, Portugal", "Vila Nova de Gaia, Portugal", "Amadora, Portugal", "Braga, Portugal",
    "Funchal, Portugal", "Coimbra, Portugal", "Setubal, Portugal", "Almada, Portugal", "Agualva-Cacem, Portugal",
    "Queluz, Portugal", "Aveiro, Portugal", "Viseu, Portugal", "Faro, Portugal", "Guimaraes, Portugal",
    "Evora, Portugal", "Leiria, Portugal", "Barreiro, Portugal", "Odivelas, Portugal", "Braganca, Portugal",
  ],
  "Italy": [
    "Rome, Italy", "Milan, Italy", "Naples, Italy", "Turin, Italy", "Palermo, Italy",
    "Genoa, Italy", "Bologna, Italy", "Florence, Italy", "Bari, Italy", "Catania, Italy",
    "Venice, Italy", "Verona, Italy", "Messina, Italy", "Padua, Italy", "Trieste, Italy",
    "Taranto, Italy", "Brescia, Italy", "Prato, Italy", "Parma, Italy", "Modena, Italy",
  ],
  "Finland": [
    "Helsinki, Finland", "Espoo, Finland", "Tampere, Finland", "Vantaa, Finland", "Oulu, Finland",
    "Turku, Finland", "Jyvaskyla, Finland", "Lahti, Finland", "Kuopio, Finland", "Pori, Finland",
    "Kouvola, Finland", "Joensuu, Finland", "Lappeenranta, Finland", "Hameenlinna, Finland", "Vaasa, Finland",
    "Seinajoki, Finland", "Rovaniemi, Finland", "Mikkeli, Finland", "Kotka, Finland", "Salo, Finland",
  ],
  "Japan": [
    "Tokyo, Japan", "Yokohama, Japan", "Osaka, Japan", "Nagoya, Japan", "Sapporo, Japan",
    "Fukuoka, Japan", "Kobe, Japan", "Kawasaki, Japan", "Kyoto, Japan", "Saitama, Japan",
    "Hiroshima, Japan", "Sendai, Japan", "Chiba, Japan", "Kitakyushu, Japan", "Sakai, Japan",
    "Niigata, Japan", "Hamamatsu, Japan", "Kumamoto, Japan", "Okayama, Japan", "Shizuoka, Japan",
  ],
  "South Korea": [
    "Seoul, South Korea", "Busan, South Korea", "Incheon, South Korea", "Daegu, South Korea", "Daejeon, South Korea",
    "Gwangju, South Korea", "Suwon, South Korea", "Ulsan, South Korea", "Changwon, South Korea", "Goyang, South Korea",
    "Yongin, South Korea", "Seongnam, South Korea", "Bucheon, South Korea", "Cheongju, South Korea", "Ansan, South Korea",
    "Jeonju, South Korea", "Anyang, South Korea", "Cheonan, South Korea", "Namyangju, South Korea", "Hwaseong, South Korea",
  ],
  "Brazil": [
    "Sao Paulo, Brazil", "Rio de Janeiro, Brazil", "Brasilia, Brazil", "Salvador, Brazil", "Fortaleza, Brazil",
    "Belo Horizonte, Brazil", "Manaus, Brazil", "Curitiba, Brazil", "Recife, Brazil", "Porto Alegre, Brazil",
    "Belem, Brazil", "Goiania, Brazil", "Guarulhos, Brazil", "Campinas, Brazil", "Sao Luis, Brazil",
    "Sao Goncalo, Brazil", "Maceio, Brazil", "Duque de Caxias, Brazil", "Natal, Brazil", "Campo Grande, Brazil",
  ],
  "Mexico": [
    "Mexico City, Mexico", "Guadalajara, Mexico", "Monterrey, Mexico", "Puebla, Mexico", "Tijuana, Mexico",
    "Leon, Mexico", "Ciudad Juarez, Mexico", "Zapopan, Mexico", "Merida, Mexico", "San Luis Potosi, Mexico",
    "Aguascalientes, Mexico", "Hermosillo, Mexico", "Mexicali, Mexico", "Culiacan, Mexico", "Queretaro, Mexico",
    "Saltillo, Mexico", "Morelia, Mexico", "Cancun, Mexico", "Chihuahua, Mexico", "Toluca, Mexico",
  ],
  "Poland": [
    "Warsaw, Poland", "Krakow, Poland", "Lodz, Poland", "Wroclaw, Poland", "Poznan, Poland",
    "Gdansk, Poland", "Szczecin, Poland", "Bydgoszcz, Poland", "Lublin, Poland", "Bialystok, Poland",
    "Katowice, Poland", "Gdynia, Poland", "Czestochowa, Poland", "Radom, Poland", "Sosnowiec, Poland",
    "Torun, Poland", "Kielce, Poland", "Rzeszow, Poland", "Gliwice, Poland", "Zabrze, Poland",
  ],
  "Czech Republic": [
    "Prague, Czech Republic", "Brno, Czech Republic", "Ostrava, Czech Republic", "Plzen, Czech Republic",
    "Liberec, Czech Republic", "Olomouc, Czech Republic", "Ceske Budejovice, Czech Republic", "Hradec Kralove, Czech Republic",
    "Usti nad Labem, Czech Republic", "Pardubice, Czech Republic", "Zlin, Czech Republic", "Havirov, Czech Republic",
    "Kladno, Czech Republic", "Most, Czech Republic", "Opava, Czech Republic", "Frydek-Mistek, Czech Republic",
    "Karvina, Czech Republic", "Jihlava, Czech Republic", "Teplice, Czech Republic", "Decin, Czech Republic",
  ],
  "Luxembourg": [
    "Luxembourg City, Luxembourg", "Esch-sur-Alzette, Luxembourg", "Differdange, Luxembourg", "Dudelange, Luxembourg",
    "Ettelbruck, Luxembourg", "Diekirch, Luxembourg", "Wiltz, Luxembourg", "Echternach, Luxembourg",
  ],
  "Saudi Arabia": [
    "Riyadh, Saudi Arabia", "Jeddah, Saudi Arabia", "Mecca, Saudi Arabia", "Medina, Saudi Arabia", "Dammam, Saudi Arabia",
    "Khobar, Saudi Arabia", "Taif, Saudi Arabia", "Tabuk, Saudi Arabia", "Buraydah, Saudi Arabia", "Khamis Mushait, Saudi Arabia",
    "Hail, Saudi Arabia", "Najran, Saudi Arabia", "Yanbu, Saudi Arabia", "Al Kharj, Saudi Arabia", "Jubail, Saudi Arabia",
    "Abha, Saudi Arabia", "Sakaka, Saudi Arabia", "Jazan, Saudi Arabia", "Qatif, Saudi Arabia", "Arar, Saudi Arabia",
  ],
};

const SUPPORTED_AUTOMATION_COUNTRIES = Object.keys(TOP_CITIES_BY_COUNTRY);

function getTopCitiesForCountry(country) {
  return TOP_CITIES_BY_COUNTRY[country] || [];
}

module.exports = { TOP_CITIES_BY_COUNTRY, SUPPORTED_AUTOMATION_COUNTRIES, getTopCitiesForCountry };
