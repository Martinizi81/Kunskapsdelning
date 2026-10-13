// De 23 lokala länsförsäkringsbolagen samt det gemensamt ägda Länsförsäkringar AB.
const COMPANIES = [
  { id: 'blekinge', name: 'Länsförsäkringar Blekinge' },
  { id: 'bergslagen', name: 'Länsförsäkringar Bergslagen' },
  { id: 'dalarna', name: 'Länsförsäkringar Dalarna' },
  { id: 'gavleborg', name: 'Länsförsäkringar Gävleborg' },
  { id: 'goinge-kristianstad', name: 'Länsförsäkringar Göinge-Kristianstad' },
  { id: 'goteborg-bohuslan', name: 'Länsförsäkringar Göteborg och Bohuslän' },
  { id: 'gotland', name: 'Länsförsäkringar Gotland' },
  { id: 'halland', name: 'Länsförsäkringar Halland' },
  { id: 'jamtland', name: 'Länsförsäkringar Jämtland' },
  { id: 'jonkoping', name: 'Länsförsäkringar Jönköping' },
  { id: 'kalmar', name: 'Länsförsäkringar Kalmar län' },
  { id: 'kronoberg', name: 'Länsförsäkringar Kronoberg' },
  { id: 'norrbotten', name: 'Länsförsäkringar Norrbotten' },
  { id: 'skaraborg', name: 'Länsförsäkringar Skaraborg' },
  { id: 'skane', name: 'Länsförsäkringar Skåne' },
  { id: 'stockholm', name: 'Länsförsäkringar Stockholm' },
  { id: 'sodermanland', name: 'Länsförsäkringar Södermanland' },
  { id: 'uppsala', name: 'Länsförsäkringar Uppsala' },
  { id: 'varmland', name: 'Länsförsäkringar Värmland' },
  { id: 'vasterbotten', name: 'Länsförsäkringar Västerbotten' },
  { id: 'vasternorrland', name: 'Länsförsäkringar Västernorrland' },
  { id: 'alvsborg', name: 'Länsförsäkringar Älvsborg' },
  { id: 'ostgota', name: 'Länsförsäkringar Östgöta' },
  { id: 'lf-ab', name: 'Länsförsäkringar AB (gemensamt)' },
];

const CATEGORIES = [
  { id: 'kund', name: 'Kundmöte & försäljning' },
  { id: 'skada', name: 'Skadehantering' },
  { id: 'bank', name: 'Bank & finans' },
  { id: 'liv-pension', name: 'Liv & pension' },
  { id: 'digitalt', name: 'Digitalisering & IT' },
  { id: 'process', name: 'Process & effektivisering' },
  { id: 'ledarskap', name: 'Ledarskap & medarbetare' },
  { id: 'hallbarhet', name: 'Hållbarhet' },
  { id: 'risk', name: 'Risk & regelefterlevnad' },
  { id: 'ovrigt', name: 'Övrigt' },
];

const companyIds = new Set(COMPANIES.map((c) => c.id));
const categoryIds = new Set(CATEGORIES.map((c) => c.id));

module.exports = { COMPANIES, CATEGORIES, companyIds, categoryIds };
