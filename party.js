// Built by `npm run build:party` from party.ts and src/party. Do not edit: change the source and rebuild.
import { z } from "zod";
// src/shared/protocol.ts
var PACK_IDS = [
	"actors",
	"movie-characters",
	"historical-figures",
	"video-games",
	"brand-mascots",
	"anime-cartoons",
	"mixed"
];
var MODES = ["twenty_questions", "describe_it"];
var MATCH_TYPES = ["points", "rounds"];
/** Who guesses first in round 1 of a match started from the lobby. Rematches use the loser rule. */
/** Where yes/no questions happen: out loud, typed in the app, or both. */
var QUESTION_MODES = [
	"spoken",
	"app",
	"both"
];
var ANSWERS = [
	"yes",
	"no",
	"sort_of",
	"dont_know"
];
/** Per-player limit on sending in-app questions. */
var QUESTION_RATE_LIMIT = {
	limit: 6,
	windowMs: 6e4
};
/** Trade turns: one question, one guess, then the other player's move. Keep going: a turn lasts until you solve it or give up. */
var TURN_FORMATS = ["trade", "keep_going"];
/** How hard the identities are. Tiers overlap on the server because hard identities are scarce. */
var DIFFICULTIES = [
	"easy",
	"medium",
	"hard"
];
var FIRST_PLAYER_OPTIONS = [
	"host",
	"opponent",
	"random"
];
/** How long the confirming player must be disconnected or away before the host may override. */
var HOST_OVERRIDE_AFTER_MS = 3e4;
var SettingsSchema = z.object({
	packId: z.enum(PACK_IDS),
	mode: z.enum(MODES),
	timerSeconds: z.union([
		z.literal(0),
		z.literal(60),
		z.literal(90)
	]),
	matchType: z.enum(MATCH_TYPES),
	firstPlayer: z.enum(FIRST_PLAYER_OPTIONS),
	hints: z.boolean(),
	questions: z.enum(QUESTION_MODES),
	turnFormat: z.enum(TURN_FORMATS).default("keep_going"),
	difficulty: z.enum(DIFFICULTIES).default("medium")
});
var DEFAULT_SETTINGS = {
	packId: "mixed",
	mode: "twenty_questions",
	timerSeconds: 0,
	matchType: "points",
	firstPlayer: "random",
	hints: true,
	questions: "both",
	turnFormat: "trade",
	difficulty: "medium"
};
var CONTROL_CHARS = /* @__PURE__ */ new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]", "g");
var NicknameSchema = z.string().transform((s) => s.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim()).pipe(z.string().min(1, "Enter a nickname").max(20, "Nicknames are at most 20 characters"));
/** In-app question text: plain text, control characters removed, whitespace collapsed, 1 to 140 characters. */
var QuestionTextSchema = z.string().max(560).transform((s) => s.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim()).pipe(z.string().min(1, "Type a question").max(140, `Questions are at most 140 characters`));
z.object({
	nickname: NicknameSchema,
	settings: SettingsSchema
});
z.object({ nickname: NicknameSchema });
z.string().transform((s) => s.trim().toUpperCase().replace(/[\s-]/g, "")).pipe(z.string().regex(new RegExp(`^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$`), "Invalid room code"));
z.string().regex(new RegExp(`^[0-9]{4}$`), "Invalid PIN");
var base = {
	/** Client-generated id; a repeated id is answered with the canonical state and never re-applied. */
	commandId: z.string().min(8).max(64),
	/** The state version the client was looking at. Stale versions are rejected. */
	expectedVersion: z.number().int().nonnegative()
};
var CommandSchema = z.discriminatedUnion("type", [
	z.object({
		...base,
		type: z.literal("player.ready"),
		ready: z.boolean()
	}),
	z.object({
		...base,
		type: z.literal("settings.update"),
		settings: SettingsSchema
	}),
	z.object({
		...base,
		type: z.literal("match.start")
	}),
	z.object({
		...base,
		type: z.literal("turn.correct.request")
	}),
	z.object({
		...base,
		type: z.literal("turn.correct.confirm")
	}),
	z.object({
		...base,
		type: z.literal("turn.correct.reject")
	}),
	z.object({
		...base,
		type: z.literal("turn.correct.override")
	}),
	z.object({
		...base,
		type: z.literal("turn.skip")
	}),
	z.object({
		...base,
		type: z.literal("turn.question")
	}),
	z.object({
		...base,
		type: z.literal("turn.hint")
	}),
	z.object({
		...base,
		type: z.literal("turn.ask"),
		text: QuestionTextSchema
	}),
	z.object({
		...base,
		type: z.literal("turn.answer"),
		questionId: z.string().min(1).max(64),
		answer: z.enum(ANSWERS)
	}),
	z.object({
		...base,
		type: z.literal("round.next")
	}),
	z.object({
		...base,
		type: z.literal("match.rematch")
	}),
	z.object({
		...base,
		type: z.literal("match.change_settings")
	}),
	z.object({
		...base,
		type: z.literal("player.leave")
	}),
	z.object({
		...base,
		type: z.literal("player.remove"),
		playerId: z.string().min(1).max(64)
	}),
	z.object({
		...base,
		type: z.literal("player.difficulty"),
		difficulty: z.enum(DIFFICULTIES).nullable()
	}),
	z.object({
		...base,
		type: z.literal("turn.pass")
	})
]);
// src/kit/shared/presence.ts
function presenceOf(p) {
	if (!p.connected) return "offline";
	return p.away ? "away" : "here";
}
/** Since when the player has been unable to act (offline or away), or null while they are here. */
function absentSince(p) {
	if (!p.connected) return p.disconnectedAt;
	return p.away ? p.awaySince ?? null : null;
}
// src/shared/packs.ts
var PACK_META = {
	mixed: {
		id: "mixed",
		name: "Mixed",
		description: "A bit of everything, drawn from every pack."
	},
	actors: {
		id: "actors",
		name: "Actors",
		description: "Film and TV stars, past and present."
	},
	"movie-characters": {
		id: "movie-characters",
		name: "Movie Characters",
		description: "Heroes, villains and icons of the big screen."
	},
	"historical-figures": {
		id: "historical-figures",
		name: "Historical Figures",
		description: "Leaders, scientists, artists and explorers."
	},
	"video-games": {
		id: "video-games",
		name: "Video Games",
		description: "Characters from classic and modern games."
	},
	"brand-mascots": {
		id: "brand-mascots",
		name: "Brand Mascots",
		description: "The faces behind cereals, snacks and ads."
	},
	"anime-cartoons": {
		id: "anime-cartoons",
		name: "Anime & Cartoons",
		description: "Animated favorites from TV and comics."
	}
};
var PACK_ORDER = [
	"mixed",
	"actors",
	"movie-characters",
	"historical-figures",
	"video-games",
	"brand-mascots",
	"anime-cartoons"
];
// src/worker/content/types.ts
/**
* Builds a pack's identities. The id is `${packId}.${slug}`; slugs are stable once
* published and must not be changed when a display name is corrected.
*/
function definePack(packId, rows, hints) {
	return rows.map(([slug, canonicalName, difficulty, aliases = [], tags = []]) => {
		const identityHints = hints[slug];
		if (!identityHints) throw new Error(`Missing hints for ${packId}.${slug}`);
		return {
			id: `${packId}.${slug}`,
			canonicalName,
			aliases: [...aliases],
			categoryId: packId,
			tags: [...tags],
			difficulty,
			active: true,
			hints: identityHints
		};
	});
}
var actors = definePack("actors", [
	[
		"tom-hanks",
		"Tom Hanks",
		"easy",
		[],
		["film", "drama"]
	],
	[
		"meryl-streep",
		"Meryl Streep",
		"easy",
		[],
		["film", "drama"]
	],
	[
		"leonardo-dicaprio",
		"Leonardo DiCaprio",
		"easy",
		["Leo DiCaprio"],
		["film"]
	],
	[
		"denzel-washington",
		"Denzel Washington",
		"easy",
		[],
		["film"]
	],
	[
		"julia-roberts",
		"Julia Roberts",
		"easy",
		[],
		["film", "romcom"]
	],
	[
		"scarlett-johansson",
		"Scarlett Johansson",
		"easy",
		[],
		["film", "superhero"]
	],
	[
		"dwayne-johnson",
		"Dwayne Johnson",
		"easy",
		["The Rock"],
		[
			"film",
			"action",
			"wrestling"
		]
	],
	[
		"keanu-reeves",
		"Keanu Reeves",
		"easy",
		[],
		["film", "action"]
	],
	[
		"jennifer-lawrence",
		"Jennifer Lawrence",
		"medium",
		[],
		["film"]
	],
	[
		"angelina-jolie",
		"Angelina Jolie",
		"easy",
		[],
		["film", "action"]
	],
	[
		"robert-downey-jr",
		"Robert Downey Jr.",
		"easy",
		["RDJ"],
		["film", "superhero"]
	],
	[
		"emma-watson",
		"Emma Watson",
		"easy",
		[],
		["film", "fantasy"]
	],
	[
		"daniel-radcliffe",
		"Daniel Radcliffe",
		"easy",
		[],
		["film", "fantasy"]
	],
	[
		"tom-cruise",
		"Tom Cruise",
		"easy",
		[],
		["film", "action"]
	],
	[
		"nicole-kidman",
		"Nicole Kidman",
		"medium",
		[],
		["film", "drama"]
	],
	[
		"sandra-bullock",
		"Sandra Bullock",
		"easy",
		[],
		["film", "comedy"]
	],
	[
		"harrison-ford",
		"Harrison Ford",
		"easy",
		[],
		["film", "adventure"]
	],
	[
		"samuel-l-jackson",
		"Samuel L. Jackson",
		"easy",
		["Samuel Jackson"],
		["film"]
	],
	[
		"viola-davis",
		"Viola Davis",
		"medium",
		[],
		[
			"film",
			"tv",
			"drama"
		]
	],
	[
		"hugh-jackman",
		"Hugh Jackman",
		"easy",
		[],
		[
			"film",
			"musical",
			"superhero"
		]
	],
	[
		"ryan-reynolds",
		"Ryan Reynolds",
		"easy",
		[],
		[
			"film",
			"comedy",
			"superhero"
		]
	],
	[
		"zendaya",
		"Zendaya",
		"easy",
		[],
		["film", "tv"]
	],
	[
		"timothee-chalamet",
		"Timothee Chalamet",
		"medium",
		["Timothée Chalamet"],
		["film"]
	],
	[
		"margot-robbie",
		"Margot Robbie",
		"easy",
		[],
		["film"]
	],
	[
		"chris-hemsworth",
		"Chris Hemsworth",
		"easy",
		[],
		["film", "superhero"]
	],
	[
		"jackie-chan",
		"Jackie Chan",
		"easy",
		[],
		[
			"film",
			"action",
			"martial arts"
		]
	],
	[
		"audrey-hepburn",
		"Audrey Hepburn",
		"medium",
		[],
		["film", "classic"]
	],
	[
		"marilyn-monroe",
		"Marilyn Monroe",
		"easy",
		[],
		["film", "classic"]
	],
	[
		"charlie-chaplin",
		"Charlie Chaplin",
		"medium",
		[],
		[
			"film",
			"classic",
			"silent"
		]
	],
	[
		"cate-blanchett",
		"Cate Blanchett",
		"medium",
		[],
		["film", "drama"]
	],
	[
		"anne-hathaway",
		"Anne Hathaway",
		"medium",
		[],
		["film"]
	],
	[
		"natalie-portman",
		"Natalie Portman",
		"medium",
		[],
		["film"]
	],
	[
		"matt-damon",
		"Matt Damon",
		"medium",
		[],
		["film", "action"]
	],
	[
		"george-clooney",
		"George Clooney",
		"easy",
		[],
		["film"]
	],
	[
		"halle-berry",
		"Halle Berry",
		"medium",
		[],
		["film"]
	],
	[
		"michelle-yeoh",
		"Michelle Yeoh",
		"medium",
		[],
		["film", "martial arts"]
	],
	[
		"idris-elba",
		"Idris Elba",
		"medium",
		[],
		["film", "tv"]
	],
	[
		"emma-stone",
		"Emma Stone",
		"medium",
		[],
		["film", "comedy"]
	],
	[
		"tom-holland",
		"Tom Holland",
		"easy",
		[],
		["film", "superhero"]
	],
	[
		"jim-carrey",
		"Jim Carrey",
		"easy",
		[],
		["film", "comedy"]
	],
	[
		"robin-williams",
		"Robin Williams",
		"easy",
		[],
		["film", "comedy"]
	],
	[
		"judi-dench",
		"Judi Dench",
		"hard",
		[],
		["film", "theatre"]
	],
	[
		"pedro-pascal",
		"Pedro Pascal",
		"medium",
		[],
		["tv", "film"]
	]
], {
	"tom-hanks": [
		"An American actor",
		"Won back-to-back Best Actor Oscars in the 1990s",
		"Starred in Cast Away, Big and Apollo 13"
	],
	"meryl-streep": [
		"An American actress",
		"Holds the record for the most Oscar nominations for acting",
		"Starred in The Devil Wears Prada and Mamma Mia!"
	],
	"leonardo-dicaprio": [
		"An American actor",
		"Finally won an Oscar for The Revenant",
		"Starred in Titanic and Inception"
	],
	"denzel-washington": [
		"An American actor",
		"Has won two Academy Awards",
		"Starred in Training Day, Glory and The Equalizer"
	],
	"julia-roberts": [
		"An American actress",
		"Famous for her big smile and romantic comedies",
		"Starred in Pretty Woman and won an Oscar for Erin Brockovich"
	],
	"scarlett-johansson": [
		"An American actress",
		"Played a superhero spy in the Marvel films",
		"Played Black Widow and starred in Lost in Translation"
	],
	"dwayne-johnson": [
		"An American actor",
		"Was a pro wrestling champion before Hollywood",
		"Starred in Jumanji and voiced Maui in Moana"
	],
	"keanu-reeves": [
		"A Canadian actor",
		"Known for action films and being famously kind",
		"Starred in The Matrix and John Wick"
	],
	"jennifer-lawrence": [
		"An American actress",
		"Won an Oscar for Silver Linings Playbook",
		"Played the heroine of The Hunger Games films"
	],
	"angelina-jolie": [
		"An American actress",
		"Also a filmmaker and UN refugee envoy",
		"Played Maleficent and starred in Mr. & Mrs. Smith"
	],
	"robert-downey-jr": [
		"An American actor",
		"Made a famous career comeback in the 2000s",
		"Played a genius billionaire in a red and gold armored suit"
	],
	"emma-watson": [
		"A British actress",
		"Became famous as a child in a series of fantasy films",
		"Starred in Little Women and played Belle in Beauty and the Beast"
	],
	"daniel-radcliffe": [
		"A British actor",
		"Became famous as a child in a series of fantasy films",
		"Played the boy wizard with a lightning-bolt scar"
	],
	"tom-cruise": [
		"An American actor",
		"Famous for doing his own dangerous stunts",
		"Starred in Top Gun and the Mission: Impossible films"
	],
	"nicole-kidman": [
		"An Australian actress",
		"Won an Oscar for playing Virginia Woolf",
		"Starred in Moulin Rouge! and Big Little Lies"
	],
	"sandra-bullock": [
		"An American actress",
		"Won an Oscar for The Blind Side",
		"Starred in Speed, Miss Congeniality and Gravity"
	],
	"harrison-ford": [
		"An American actor",
		"Worked as a carpenter before his big break",
		"Played Han Solo and a whip-cracking archaeologist"
	],
	"samuel-l-jackson": [
		"An American actor",
		"One of the highest-grossing actors of all time",
		"Played Nick Fury and starred in Pulp Fiction"
	],
	"viola-davis": [
		"An American actress",
		"Has won an Oscar, an Emmy, a Grammy and a top Broadway award",
		"Starred in Fences and How to Get Away with Murder"
	],
	"hugh-jackman": [
		"An Australian actor",
		"Equally at home in musicals and action films",
		"Played Wolverine and starred in The Greatest Showman"
	],
	"ryan-reynolds": [
		"A Canadian actor",
		"Known for fast, sarcastic comedy",
		"Played the wisecracking antihero Deadpool"
	],
	"zendaya": [
		"An American actress and singer",
		"Started out on a Disney Channel sitcom",
		"Starred in Euphoria and Dune, and played MJ in Marvel films"
	],
	"timothee-chalamet": [
		"An American actor",
		"Rose to fame in Call Me by Your Name",
		"Played Paul Atreides in Dune"
	],
	"margot-robbie": [
		"An Australian actress",
		"Played Harley Quinn in DC films",
		"Starred as the title doll in the 2023 hit Barbie"
	],
	"chris-hemsworth": [
		"An Australian actor",
		"One of three acting brothers",
		"Played the god of thunder in the Marvel films"
	],
	"jackie-chan": [
		"A Chinese actor",
		"Famous for comedic martial arts and doing his own stunts",
		"Starred in Rush Hour and Police Story"
	],
	"audrey-hepburn": [
		"A classic Hollywood actress",
		"Also a UNICEF ambassador",
		"Starred in Breakfast at Tiffany's and Roman Holiday"
	],
	"marilyn-monroe": [
		"A classic Hollywood actress",
		"A 1950s icon with platinum blonde hair",
		"Famous for the white dress scene in The Seven Year Itch"
	],
	"charlie-chaplin": [
		"A British actor and filmmaker",
		"A star of the silent film era",
		"Created the Little Tramp with a bowler hat and cane"
	],
	"cate-blanchett": [
		"An Australian actress",
		"Has won two Oscars",
		"Played Galadriel in The Lord of the Rings"
	],
	"anne-hathaway": [
		"An American actress",
		"Won an Oscar for Les Misérables",
		"Starred in The Princess Diaries and The Devil Wears Prada"
	],
	"natalie-portman": [
		"An Israeli-American actress",
		"Started acting as a child in Léon: The Professional",
		"Played Padmé in Star Wars and won an Oscar for Black Swan"
	],
	"matt-damon": [
		"An American actor",
		"Won an Oscar for co-writing Good Will Hunting",
		"Played Jason Bourne and starred in The Martian"
	],
	"george-clooney": [
		"An American actor and director",
		"First became famous on the TV drama ER",
		"Starred in Ocean's Eleven"
	],
	"halle-berry": [
		"An American actress",
		"First Black woman to win the Best Actress Oscar",
		"Played Storm in X-Men and starred in Monster's Ball"
	],
	"michelle-yeoh": [
		"A Malaysian actress",
		"A martial arts film star since the 1980s",
		"Won an Oscar for Everything Everywhere All at Once"
	],
	"idris-elba": [
		"A British actor",
		"Also works as a DJ",
		"Starred in Luther and The Wire"
	],
	"emma-stone": [
		"An American actress",
		"Has won two Best Actress Oscars",
		"Starred in La La Land and Poor Things"
	],
	"tom-holland": [
		"A British actor",
		"Trained in dance and gymnastics",
		"Played the teenage web-slinger in the Marvel films"
	],
	"jim-carrey": [
		"A Canadian-American actor",
		"Famous for rubber-faced physical comedy",
		"Starred in The Mask, Ace Ventura and The Truman Show"
	],
	"robin-williams": [
		"An American actor and comedian",
		"Known for lightning-fast improvisation",
		"Voiced the Genie in Aladdin and starred in Mrs. Doubtfire"
	],
	"judi-dench": [
		"A British actress",
		"A legend of the London stage",
		"Played the British spy chief M on film"
	],
	"pedro-pascal": [
		"A Chilean-American actor",
		"Plays gruff protectors of young companions",
		"Starred in The Mandalorian and The Last of Us"
	]
});
var animeCartoons = definePack("anime-cartoons", [
	[
		"mickey-mouse",
		"Mickey Mouse",
		"easy",
		["Mickey"],
		["disney"]
	],
	[
		"minnie-mouse",
		"Minnie Mouse",
		"easy",
		["Minnie"],
		["disney"]
	],
	[
		"donald-duck",
		"Donald Duck",
		"easy",
		[],
		["disney"]
	],
	[
		"goofy",
		"Goofy",
		"easy",
		[],
		["disney"]
	],
	[
		"bugs-bunny",
		"Bugs Bunny",
		"easy",
		[],
		["looney tunes"]
	],
	[
		"daffy-duck",
		"Daffy Duck",
		"easy",
		[],
		["looney tunes"]
	],
	[
		"tweety",
		"Tweety Bird",
		"easy",
		["Tweety"],
		["looney tunes"]
	],
	[
		"wile-e-coyote",
		"Wile E. Coyote",
		"medium",
		[],
		["looney tunes"]
	],
	[
		"road-runner",
		"Road Runner",
		"medium",
		["The Road Runner"],
		["looney tunes"]
	],
	[
		"spongebob",
		"SpongeBob SquarePants",
		"easy",
		["SpongeBob"],
		["nickelodeon"]
	],
	[
		"patrick-star",
		"Patrick Star",
		"easy",
		[],
		["nickelodeon"]
	],
	[
		"homer-simpson",
		"Homer Simpson",
		"easy",
		[],
		["the simpsons"]
	],
	[
		"bart-simpson",
		"Bart Simpson",
		"easy",
		[],
		["the simpsons"]
	],
	[
		"scooby-doo",
		"Scooby-Doo",
		"easy",
		["Scooby"],
		["hanna-barbera"]
	],
	[
		"fred-flintstone",
		"Fred Flintstone",
		"easy",
		[],
		["hanna-barbera"]
	],
	[
		"popeye",
		"Popeye",
		"easy",
		["Popeye the Sailor"],
		["classic"]
	],
	[
		"snoopy",
		"Snoopy",
		"easy",
		[],
		["peanuts"]
	],
	[
		"charlie-brown",
		"Charlie Brown",
		"easy",
		[],
		["peanuts"]
	],
	[
		"garfield",
		"Garfield",
		"easy",
		[],
		["comics"]
	],
	[
		"winnie-the-pooh",
		"Winnie the Pooh",
		"easy",
		["Pooh Bear", "Pooh"],
		["disney"]
	],
	[
		"tigger",
		"Tigger",
		"easy",
		[],
		["disney"]
	],
	[
		"goku",
		"Goku",
		"easy",
		["Son Goku", "Kakarot"],
		["anime", "dragon ball"]
	],
	[
		"naruto",
		"Naruto Uzumaki",
		"easy",
		["Naruto"],
		["anime"]
	],
	[
		"sailor-moon",
		"Sailor Moon",
		"medium",
		["Usagi Tsukino"],
		["anime"]
	],
	[
		"luffy",
		"Monkey D. Luffy",
		"medium",
		["Luffy"],
		["anime", "one piece"]
	],
	[
		"totoro",
		"Totoro",
		"medium",
		["My Neighbor Totoro"],
		["anime", "ghibli"]
	],
	[
		"doraemon",
		"Doraemon",
		"medium",
		[],
		["anime"]
	],
	[
		"hello-kitty",
		"Hello Kitty",
		"easy",
		[],
		["sanrio"]
	],
	[
		"peppa-pig",
		"Peppa Pig",
		"easy",
		["Peppa"],
		["preschool"]
	],
	[
		"bluey",
		"Bluey",
		"easy",
		[],
		["preschool"]
	],
	[
		"dora",
		"Dora the Explorer",
		"easy",
		["Dora"],
		["preschool"]
	],
	[
		"pink-panther",
		"The Pink Panther",
		"medium",
		["Pink Panther"],
		["classic"]
	],
	[
		"rick-sanchez",
		"Rick Sanchez",
		"medium",
		["Rick"],
		["adult animation"]
	],
	[
		"optimus-prime",
		"Optimus Prime",
		"easy",
		[],
		["transformers"]
	],
	[
		"ash-ketchum",
		"Ash Ketchum",
		"medium",
		["Ash"],
		["anime", "pokemon"]
	],
	[
		"aang",
		"Aang",
		"medium",
		["Avatar Aang"],
		["nickelodeon"]
	],
	[
		"tanjiro",
		"Tanjiro Kamado",
		"hard",
		["Tanjiro"],
		["anime", "demon slayer"]
	],
	[
		"astro-boy",
		"Astro Boy",
		"hard",
		["Atom"],
		["anime", "classic"]
	],
	[
		"he-man",
		"He-Man",
		"medium",
		[],
		["classic"]
	],
	[
		"powerpuff-blossom",
		"Blossom from The Powerpuff Girls",
		"medium",
		["Blossom"],
		["cartoon network"]
	]
], {
	"mickey-mouse": [
		"A cartoon character",
		"A cheerful rodent with big round ears",
		"Disney's original star, first seen in Steamboat Willie"
	],
	"minnie-mouse": [
		"A cartoon character",
		"Wears a polka-dot bow and dress",
		"Disney's leading lady mouse"
	],
	"donald-duck": [
		"A cartoon character",
		"A hot-tempered bird in a sailor shirt",
		"Disney duck with famously hard-to-understand speech"
	],
	"goofy": [
		"A cartoon character",
		"A tall, clumsy dog with a big laugh",
		"Disney dog famous for his \"Ah-hyuck!\" laugh and falling-down holler"
	],
	"bugs-bunny": [
		"A cartoon character",
		"A wisecracking gray rabbit",
		"Munches a carrot and asks \"What's up, Doc?\""
	],
	"daffy-duck": [
		"A cartoon character",
		"A black bird with a lisp",
		"The Looney Tunes duck who says \"You're despicable!\""
	],
	"tweety": [
		"A cartoon character",
		"A tiny yellow canary",
		"Says \"I tawt I taw a puddy tat!\""
	],
	"wile-e-coyote": [
		"A cartoon character",
		"Orders gadgets from the Acme company",
		"Endlessly chases a fast desert bird and always fails"
	],
	"road-runner": [
		"A cartoon character",
		"A very fast desert bird",
		"Says \"Meep meep!\" while escaping a coyote"
	],
	"spongebob": [
		"A cartoon character",
		"Lives in a pineapple under the sea",
		"A yellow sea sponge who flips Krabby Patties"
	],
	"patrick-star": [
		"A cartoon character",
		"A dim but loyal pink starfish in Bikini Bottom",
		"A sea sponge's best friend"
	],
	"homer-simpson": [
		"A cartoon character",
		"A dad who works at a nuclear power plant",
		"Says \"D'oh!\" and loves donuts in Springfield"
	],
	"bart-simpson": [
		"A cartoon character",
		"A spiky-haired prankster on a skateboard",
		"Springfield's 10-year-old who says \"Eat my shorts!\""
	],
	"scooby-doo": [
		"A cartoon character",
		"A cowardly Great Dane who solves mysteries",
		"Rides in the Mystery Machine and loves snacks"
	],
	"fred-flintstone": [
		"A cartoon character",
		"A Stone Age family man",
		"Yells \"Yabba dabba doo!\" in Bedrock"
	],
	"popeye": [
		"A cartoon character",
		"A sailor with a pipe and huge forearms",
		"Gets super strong after eating spinach"
	],
	"snoopy": [
		"A cartoon character",
		"A beagle who sleeps on top of his doghouse",
		"Imagines fighting the Red Baron in the Peanuts strip"
	],
	"charlie-brown": [
		"A cartoon character",
		"A boy in a zigzag shirt",
		"Never manages to kick the football in Peanuts"
	],
	"garfield": [
		"A cartoon character",
		"A lazy orange cat",
		"Loves lasagna and hates Mondays"
	],
	"winnie-the-pooh": [
		"A cartoon character",
		"A bear of very little brain",
		"Loves honey and lives in the Hundred Acre Wood"
	],
	"tigger": [
		"A cartoon character",
		"A bouncy striped animal",
		"The tiger from the Hundred Acre Wood who bounces on his tail"
	],
	"goku": [
		"An anime character",
		"A martial artist with spiky black hair",
		"A Saiyan hero of Dragon Ball who powers up with golden hair"
	],
	"naruto": [
		"An anime character",
		"An orange-clad ninja who wants to be Hokage",
		"Has a nine-tailed fox sealed inside him"
	],
	"sailor-moon": [
		"An anime character",
		"A schoolgirl with long blonde pigtails",
		"Fights evil by moonlight as a magical girl"
	],
	"luffy": [
		"An anime character",
		"A pirate whose body stretches like rubber",
		"Wears a straw hat and wants to find the One Piece"
	],
	"totoro": [
		"An anime character",
		"A big, gray, fluffy forest spirit",
		"Studio Ghibli's mascot who waits at a bus stop in the rain"
	],
	"doraemon": [
		"An anime character",
		"A blue robot cat from the future",
		"Pulls gadgets out of his four-dimensional pocket"
	],
	"hello-kitty": [
		"A cartoon character",
		"A white cat with a red bow and no mouth",
		"Sanrio's most famous character"
	],
	"peppa-pig": [
		"A cartoon character",
		"A cheerful pink piglet",
		"A British preschool star who loves jumping in muddy puddles"
	],
	"bluey": [
		"A cartoon character",
		"An energetic puppy from Brisbane",
		"An Australian Blue Heeler puppy who loves imaginative games"
	],
	"dora": [
		"A cartoon character",
		"A bilingual girl with a talking backpack",
		"Explores with her monkey friend Boots and asks viewers for help"
	],
	"pink-panther": [
		"A cartoon character",
		"A cool, silent cat who walks on two legs",
		"Struts to a famous jazz theme by Henry Mancini"
	],
	"rick-sanchez": [
		"A cartoon character",
		"A cynical genius scientist in a lab coat",
		"Drags his grandson on adventures across dimensions"
	],
	"optimus-prime": [
		"A cartoon character",
		"Leader of a team of alien robots",
		"Autobot leader who transforms into a truck"
	],
	"ash-ketchum": [
		"An anime character",
		"A boy from Pallet Town on a long journey",
		"A trainer who wants to be a Pokémon Master"
	],
	"aang": [
		"A cartoon character",
		"A bald monk with blue arrow tattoos",
		"The last Airbender, who must master all four elements"
	],
	"tanjiro": [
		"An anime character",
		"A kind boy with a checkered green haori",
		"Hunts demons to save his sister in Demon Slayer"
	],
	"astro-boy": [
		"An anime character",
		"A robot boy with rocket boots",
		"Osamu Tezuka's classic robot hero"
	],
	"he-man": [
		"A cartoon character",
		"Defends Castle Grayskull",
		"Shouts \"I have the power!\" as the most powerful man in the universe"
	],
	"powerpuff-blossom": [
		"A cartoon character",
		"A superhero girl with a big red bow",
		"The redheaded leader of the Powerpuff Girls"
	]
});
var brandMascots = definePack("brand-mascots", [
	[
		"ronald-mcdonald",
		"Ronald McDonald",
		"easy",
		[],
		["fast food"]
	],
	[
		"colonel-sanders",
		"Colonel Sanders",
		"easy",
		["The Colonel"],
		["fast food"]
	],
	[
		"tony-the-tiger",
		"Tony the Tiger",
		"easy",
		["Tony"],
		["cereal"]
	],
	[
		"mr-peanut",
		"Mr. Peanut",
		"easy",
		[],
		["snack"]
	],
	[
		"michelin-man",
		"The Michelin Man",
		"easy",
		["Bibendum", "Michelin Man"],
		["tires"]
	],
	[
		"pillsbury-doughboy",
		"The Pillsbury Doughboy",
		"easy",
		["Poppin' Fresh", "Doughboy"],
		["baking"]
	],
	[
		"kool-aid-man",
		"The Kool-Aid Man",
		"easy",
		["Kool-Aid Man"],
		["drink"]
	],
	[
		"energizer-bunny",
		"The Energizer Bunny",
		"easy",
		["Energizer Bunny"],
		["batteries"]
	],
	[
		"geico-gecko",
		"The GEICO Gecko",
		"easy",
		["Gecko"],
		["insurance"]
	],
	[
		"mr-clean",
		"Mr. Clean",
		"easy",
		[],
		["cleaning"]
	],
	[
		"chester-cheetah",
		"Chester Cheetah",
		"medium",
		[],
		["snack"]
	],
	[
		"trix-rabbit",
		"The Trix Rabbit",
		"medium",
		["Trix Rabbit"],
		["cereal"]
	],
	[
		"toucan-sam",
		"Toucan Sam",
		"medium",
		[],
		["cereal"]
	],
	[
		"capn-crunch",
		"Cap'n Crunch",
		"medium",
		["Captain Crunch"],
		["cereal"]
	],
	[
		"jolly-green-giant",
		"The Jolly Green Giant",
		"medium",
		["Green Giant"],
		["vegetables"]
	],
	[
		"wendy",
		"Wendy from Wendy's",
		"easy",
		["Wendy"],
		["fast food"]
	],
	[
		"burger-king",
		"The Burger King",
		"medium",
		["The King"],
		["fast food"]
	],
	[
		"jack-box",
		"Jack from Jack in the Box",
		"hard",
		["Jack Box"],
		["fast food"]
	],
	[
		"aflac-duck",
		"The Aflac Duck",
		"medium",
		["Aflac Duck"],
		["insurance"]
	],
	[
		"mr-monopoly",
		"Mr. Monopoly",
		"easy",
		["Rich Uncle Pennybags"],
		["board game"]
	],
	[
		"charlie-the-tuna",
		"Charlie the Tuna",
		"hard",
		[],
		["seafood"]
	],
	[
		"gerber-baby",
		"The Gerber Baby",
		"hard",
		["Gerber Baby"],
		["baby food"]
	],
	[
		"elsie-the-cow",
		"Elsie the Cow",
		"hard",
		[],
		["dairy"]
	],
	[
		"quaker-oats-man",
		"The Quaker Oats Man",
		"medium",
		["Larry"],
		["cereal"]
	],
	[
		"betty-crocker",
		"Betty Crocker",
		"medium",
		[],
		["baking"]
	],
	[
		"hamburglar",
		"The Hamburglar",
		"medium",
		["Hamburglar"],
		["fast food"]
	],
	[
		"grimace",
		"Grimace",
		"medium",
		[],
		["fast food"]
	],
	[
		"chuck-e-cheese",
		"Chuck E. Cheese",
		"easy",
		[],
		["restaurant"]
	],
	[
		"smokey-bear",
		"Smokey Bear",
		"easy",
		["Smokey the Bear"],
		["public service"]
	],
	[
		"big-boy",
		"Big Boy",
		"hard",
		[],
		["restaurant"]
	],
	[
		"morton-salt-girl",
		"The Morton Salt Girl",
		"hard",
		["Morton Salt Girl"],
		["grocery"]
	],
	[
		"gortons-fisherman",
		"The Gorton's Fisherman",
		"hard",
		["Gorton's Fisherman"],
		["seafood"]
	],
	[
		"coca-cola-polar-bear",
		"The Coca-Cola Polar Bear",
		"medium",
		["Coke Polar Bear"],
		["drink"]
	],
	[
		"lucky-the-leprechaun",
		"Lucky the Leprechaun",
		"medium",
		["Lucky"],
		["cereal"]
	],
	[
		"sonny-the-cuckoo-bird",
		"Sonny the Cuckoo Bird",
		"hard",
		["Sonny"],
		["cereal"]
	],
	[
		"mr-pringle",
		"Mr. Pringle",
		"medium",
		["Julius Pringles"],
		["snack"]
	],
	[
		"duo-the-owl",
		"Duo the Duolingo Owl",
		"easy",
		["Duo"],
		["app"]
	],
	[
		"clippy",
		"Clippy",
		"medium",
		["Clippit"],
		["software"]
	],
	[
		"flo-progressive",
		"Flo from Progressive",
		"medium",
		["Flo"],
		["insurance"]
	],
	[
		"jake-from-state-farm",
		"Jake from State Farm",
		"medium",
		[],
		["insurance"]
	]
], {
	"ronald-mcdonald": [
		"A brand mascot",
		"A fast food clown with red hair",
		"The clown mascot of the Golden Arches"
	],
	"colonel-sanders": [
		"A brand mascot based on a real person",
		"A white-suited Southern gentleman with a goatee",
		"The founder and face of Kentucky Fried Chicken"
	],
	"tony-the-tiger": [
		"A cereal mascot",
		"A striped cat in a red neckerchief",
		"Says Frosted Flakes are \"Grrreat!\""
	],
	"mr-peanut": [
		"A snack mascot",
		"Wears a top hat, a monocle and white gloves",
		"The dapper legume of Planters"
	],
	"michelin-man": [
		"A brand mascot",
		"A white figure made of stacked rings",
		"Built from tires for a French tire company"
	],
	"pillsbury-doughboy": [
		"A baking brand mascot",
		"A small white figure in a chef's hat",
		"Giggles \"Hoo hoo!\" when poked in the belly"
	],
	"kool-aid-man": [
		"A drink mascot",
		"A giant red pitcher with a smiling face",
		"Bursts through walls yelling \"Oh yeah!\""
	],
	"energizer-bunny": [
		"A brand mascot",
		"A pink toy rabbit in sunglasses",
		"Keeps going and going, beating a bass drum"
	],
	"geico-gecko": [
		"An insurance mascot",
		"A small green lizard with a British accent",
		"Says 15 minutes could save you 15 percent"
	],
	"mr-clean": [
		"A cleaning product mascot",
		"A bald, muscular man with an earring",
		"Crosses his arms on a bottle of household cleaner"
	],
	"chester-cheetah": [
		"A snack mascot",
		"A cool spotted cat in sunglasses",
		"Promotes Cheetos and says it ain't easy being cheesy"
	],
	"trix-rabbit": [
		"A cereal mascot",
		"A white rabbit who never gets to eat his cereal",
		"Told that his fruity cereal is for kids"
	],
	"toucan-sam": [
		"A cereal mascot",
		"A colorful tropical bird with a big striped beak",
		"Follows his nose to Froot Loops"
	],
	"capn-crunch": [
		"A cereal mascot",
		"A naval commander in a blue uniform",
		"Commands a ship called the S.S. Guppy"
	],
	"jolly-green-giant": [
		"A food brand mascot",
		"A huge figure who stands in a valley",
		"Says \"Ho ho ho!\" for canned vegetables"
	],
	"wendy": [
		"A fast food mascot",
		"A freckled girl with red pigtails",
		"The face of a burger chain founded by her father"
	],
	"burger-king": [
		"A fast food mascot",
		"A silent royal figure with a fixed grin",
		"Wears a crown and cape for a flame-grilled burger chain"
	],
	"jack-box": [
		"A fast food mascot",
		"A businessman with a giant round white head",
		"Wears a pointy yellow hat and runs a burger chain"
	],
	"aflac-duck": [
		"An insurance mascot",
		"A white bird who quacks a company's name",
		"The duck of a supplemental insurance company"
	],
	"mr-monopoly": [
		"A board game mascot",
		"An old man with a white mustache and top hat",
		"Sends you to jail on the most famous property board game"
	],
	"charlie-the-tuna": [
		"A seafood mascot",
		"A fish in sunglasses and a beret",
		"StarKist rejects him because he isn't good enough"
	],
	"gerber-baby": [
		"A baby food mascot",
		"A charcoal sketch of a smiling infant",
		"The face on jars of baby food since 1928"
	],
	"elsie-the-cow": [
		"A dairy mascot",
		"A cartoon cow with a daisy chain",
		"Borden's dairy brand mascot"
	],
	"quaker-oats-man": [
		"A cereal mascot",
		"A smiling man with long white hair and a hat",
		"Appears on the round cardboard oatmeal canister"
	],
	"betty-crocker": [
		"A fictional baking brand persona",
		"A made-up home cook from the 1920s",
		"Her name is on cake mixes and a famous red-spoon cookbook"
	],
	"hamburglar": [
		"A fast food mascot",
		"A small thief in a striped outfit and mask",
		"Steals hamburgers and says \"Robble robble\""
	],
	"grimace": [
		"A fast food mascot",
		"A big, round, purple creature",
		"Got a famous purple birthday shake in 2023"
	],
	"chuck-e-cheese": [
		"A restaurant mascot",
		"A mouse who runs a family pizza place",
		"Mascot of the arcade and pizza chain for kids' parties"
	],
	"smokey-bear": [
		"A public service mascot",
		"Wears a ranger hat and blue jeans",
		"Says only you can prevent wildfires"
	],
	"big-boy": [
		"A restaurant mascot",
		"A chubby boy in checkered overalls",
		"Holds a double-decker burger above his head"
	],
	"morton-salt-girl": [
		"A grocery brand mascot",
		"A girl with an umbrella in the rain",
		"\"When it rains, it pours\""
	],
	"gortons-fisherman": [
		"A seafood mascot",
		"A bearded sailor in a yellow raincoat",
		"The face of frozen fish sticks"
	],
	"coca-cola-polar-bear": [
		"A drink mascot",
		"A white Arctic animal in holiday ads",
		"Drinks a bottle of cola while watching the northern lights"
	],
	"lucky-the-leprechaun": [
		"A cereal mascot",
		"A tiny Irish figure in a green hat",
		"Guards his marshmallow charms from kids"
	],
	"sonny-the-cuckoo-bird": [
		"A cereal mascot",
		"A brown bird who goes wild for chocolate",
		"Cuckoo for Cocoa Puffs"
	],
	"mr-pringle": [
		"A snack mascot",
		"A man with a big mustache and parted hair",
		"His face is on the tube of stackable chips"
	],
	"duo-the-owl": [
		"An app mascot",
		"A green bird who reminds you to practice",
		"The language-learning app's famously pushy owl"
	],
	"clippy": [
		"A software mascot",
		"A paperclip with googly eyes",
		"Popped up in Microsoft Office asking if you need help"
	],
	"flo-progressive": [
		"An insurance mascot",
		"A cheerful saleswoman in a white apron",
		"Works the Superstore counter in Progressive ads"
	],
	"jake-from-state-farm": [
		"An insurance mascot",
		"Answers a late-night call in khakis",
		"A good neighbor's agent in a red polo"
	]
});
var historicalFigures = definePack("historical-figures", [
	[
		"albert-einstein",
		"Albert Einstein",
		"easy",
		["Einstein"],
		["science", "physics"]
	],
	[
		"cleopatra",
		"Cleopatra",
		"easy",
		[],
		[
			"ancient",
			"ruler",
			"egypt"
		]
	],
	[
		"abraham-lincoln",
		"Abraham Lincoln",
		"easy",
		["Abe Lincoln"],
		["politics", "usa"]
	],
	[
		"george-washington",
		"George Washington",
		"easy",
		[],
		["politics", "usa"]
	],
	[
		"napoleon-bonaparte",
		"Napoleon Bonaparte",
		"easy",
		["Napoleon"],
		["ruler", "france"]
	],
	[
		"leonardo-da-vinci",
		"Leonardo da Vinci",
		"easy",
		["Da Vinci"],
		["art", "invention"]
	],
	[
		"william-shakespeare",
		"William Shakespeare",
		"easy",
		["Shakespeare"],
		["writing", "theatre"]
	],
	[
		"marie-curie",
		"Marie Curie",
		"easy",
		[],
		["science", "chemistry"]
	],
	[
		"isaac-newton",
		"Isaac Newton",
		"easy",
		["Newton"],
		["science", "physics"]
	],
	[
		"mahatma-gandhi",
		"Mahatma Gandhi",
		"easy",
		["Gandhi"],
		["politics", "india"]
	],
	[
		"martin-luther-king-jr",
		"Martin Luther King Jr.",
		"easy",
		["MLK"],
		["civil rights", "usa"]
	],
	[
		"nelson-mandela",
		"Nelson Mandela",
		"easy",
		["Mandela"],
		["politics", "south africa"]
	],
	[
		"elizabeth-i",
		"Queen Elizabeth I",
		"medium",
		["Elizabeth I"],
		["ruler", "england"]
	],
	[
		"julius-caesar",
		"Julius Caesar",
		"easy",
		["Caesar"],
		["ancient", "rome"]
	],
	[
		"joan-of-arc",
		"Joan of Arc",
		"medium",
		[],
		["france", "medieval"]
	],
	[
		"galileo-galilei",
		"Galileo Galilei",
		"medium",
		["Galileo"],
		["science", "astronomy"]
	],
	[
		"charles-darwin",
		"Charles Darwin",
		"easy",
		["Darwin"],
		["science", "biology"]
	],
	[
		"amelia-earhart",
		"Amelia Earhart",
		"medium",
		[],
		["aviation", "explorer"]
	],
	[
		"neil-armstrong",
		"Neil Armstrong",
		"easy",
		[],
		["space", "explorer"]
	],
	[
		"rosa-parks",
		"Rosa Parks",
		"medium",
		[],
		["civil rights", "usa"]
	],
	[
		"florence-nightingale",
		"Florence Nightingale",
		"medium",
		[],
		["medicine"]
	],
	[
		"mozart",
		"Wolfgang Amadeus Mozart",
		"easy",
		["Mozart"],
		["music", "composer"]
	],
	[
		"beethoven",
		"Ludwig van Beethoven",
		"easy",
		["Beethoven"],
		["music", "composer"]
	],
	[
		"vincent-van-gogh",
		"Vincent van Gogh",
		"easy",
		["Van Gogh"],
		["art", "painter"]
	],
	[
		"pablo-picasso",
		"Pablo Picasso",
		"easy",
		["Picasso"],
		["art", "painter"]
	],
	[
		"frida-kahlo",
		"Frida Kahlo",
		"medium",
		[],
		["art", "painter"]
	],
	[
		"thomas-edison",
		"Thomas Edison",
		"easy",
		["Edison"],
		["invention"]
	],
	[
		"nikola-tesla",
		"Nikola Tesla",
		"medium",
		[],
		["invention", "science"]
	],
	[
		"benjamin-franklin",
		"Benjamin Franklin",
		"easy",
		["Ben Franklin"],
		[
			"politics",
			"invention",
			"usa"
		]
	],
	[
		"alexander-the-great",
		"Alexander the Great",
		"medium",
		[],
		["ancient", "ruler"]
	],
	[
		"genghis-khan",
		"Genghis Khan",
		"medium",
		[],
		["ruler", "mongolia"]
	],
	[
		"tutankhamun",
		"King Tutankhamun",
		"medium",
		["King Tut", "Tutankhamun"],
		["ancient", "egypt"]
	],
	[
		"queen-victoria",
		"Queen Victoria",
		"medium",
		[],
		["ruler", "england"]
	],
	[
		"winston-churchill",
		"Winston Churchill",
		"easy",
		["Churchill"],
		["politics", "england"]
	],
	[
		"harriet-tubman",
		"Harriet Tubman",
		"medium",
		[],
		["civil rights", "usa"]
	],
	[
		"ada-lovelace",
		"Ada Lovelace",
		"hard",
		[],
		["science", "computing"]
	],
	[
		"marco-polo",
		"Marco Polo",
		"medium",
		[],
		["explorer"]
	],
	[
		"confucius",
		"Confucius",
		"medium",
		[],
		["philosophy", "china"]
	],
	[
		"socrates",
		"Socrates",
		"medium",
		[],
		["philosophy", "ancient"]
	],
	[
		"frederick-douglass",
		"Frederick Douglass",
		"hard",
		[],
		["civil rights", "writing"]
	],
	[
		"helen-keller",
		"Helen Keller",
		"medium",
		[],
		["writing", "activism"]
	]
], {
	"albert-einstein": [
		"A scientist",
		"A German-born physicist with famously wild hair",
		"Came up with the theory of relativity and E = mc²"
	],
	"cleopatra": [
		"A ruler from the ancient world",
		"The last active ruler of Ptolemaic Egypt",
		"An Egyptian queen linked with Mark Antony"
	],
	"abraham-lincoln": [
		"An American political leader",
		"Born in a log cabin in Kentucky",
		"The 16th US president, who gave the Gettysburg Address"
	],
	"george-washington": [
		"An American political leader",
		"Commanded the Continental Army",
		"The first president of the United States"
	],
	"napoleon-bonaparte": [
		"A European military leader",
		"Crowned himself emperor",
		"French emperor defeated at Waterloo"
	],
	"leonardo-da-vinci": [
		"A Renaissance figure",
		"An Italian painter, inventor and scientist",
		"Painted the Mona Lisa and The Last Supper"
	],
	"william-shakespeare": [
		"A writer from the past",
		"An English playwright and poet",
		"Wrote Romeo and Juliet and Hamlet"
	],
	"marie-curie": [
		"A scientist",
		"A Polish-French pioneer of radioactivity",
		"The first person to win two Nobel Prizes"
	],
	"isaac-newton": [
		"A scientist",
		"An English mathematician and physicist",
		"Described gravity, supposedly after an apple fell"
	],
	"mahatma-gandhi": [
		"A political leader",
		"Led a nonviolent movement for independence",
		"Led India's independence movement and the Salt March"
	],
	"martin-luther-king-jr": [
		"An American leader",
		"A Baptist minister and civil rights leader",
		"Gave the \"I Have a Dream\" speech"
	],
	"nelson-mandela": [
		"A political leader",
		"Spent 27 years in prison",
		"The first Black president of South Africa"
	],
	"elizabeth-i": [
		"A ruler from the past",
		"Known as the Virgin Queen",
		"English queen whose navy defeated the Spanish Armada"
	],
	"julius-caesar": [
		"A ruler from the ancient world",
		"A Roman general who crossed the Rubicon",
		"Assassinated on the Ides of March"
	],
	"joan-of-arc": [
		"A historical heroine",
		"A French peasant girl who led an army",
		"The Maid of Orléans, later made a saint"
	],
	"galileo-galilei": [
		"A scientist",
		"An Italian astronomer who improved the telescope",
		"Put on trial for saying the Earth orbits the Sun"
	],
	"charles-darwin": [
		"A scientist",
		"An English naturalist who sailed on HMS Beagle",
		"Developed the theory of evolution by natural selection"
	],
	"amelia-earhart": [
		"An American pioneer",
		"A record-setting aviator",
		"First woman to fly solo across the Atlantic, later lost over the Pacific"
	],
	"neil-armstrong": [
		"An American explorer",
		"A NASA astronaut and former test pilot",
		"The first person to walk on the Moon"
	],
	"rosa-parks": [
		"An American civil rights figure",
		"Her arrest sparked the Montgomery bus boycott",
		"Refused to give up her bus seat in 1955"
	],
	"florence-nightingale": [
		"A historical figure in medicine",
		"Founder of modern nursing",
		"Known as The Lady with the Lamp in the Crimean War"
	],
	"mozart": [
		"A composer",
		"An Austrian child prodigy",
		"Composed The Magic Flute and Eine kleine Nachtmusik"
	],
	"beethoven": [
		"A composer",
		"A German composer who kept working after going deaf",
		"Composed the Fifth Symphony and Ode to Joy"
	],
	"vincent-van-gogh": [
		"An artist",
		"A Dutch post-impressionist painter",
		"Painted The Starry Night and Sunflowers"
	],
	"pablo-picasso": [
		"An artist",
		"A Spanish painter and sculptor",
		"Co-founded Cubism and painted Guernica"
	],
	"frida-kahlo": [
		"An artist",
		"A Mexican painter famous for self-portraits",
		"Known for her unibrow, flower crowns and the Blue House"
	],
	"thomas-edison": [
		"An inventor",
		"An American with over a thousand patents",
		"Invented the phonograph and a practical light bulb"
	],
	"nikola-tesla": [
		"An inventor",
		"A Serbian-American engineer",
		"Pioneer of alternating current, now the name of a car brand"
	],
	"benjamin-franklin": [
		"An American founding figure",
		"A printer, writer and inventor",
		"Flew a kite in a thunderstorm and is on the $100 bill"
	],
	"alexander-the-great": [
		"A ruler from the ancient world",
		"A Macedonian ruler taught by Aristotle",
		"Built a vast empire before age 33"
	],
	"genghis-khan": [
		"A ruler from the past",
		"Founder of a huge empire on the steppe",
		"Founder of the Mongol Empire"
	],
	"tutankhamun": [
		"A ruler from the ancient world",
		"An Egyptian pharaoh who died young",
		"Boy pharaoh whose golden tomb was found in 1922"
	],
	"queen-victoria": [
		"A ruler from the past",
		"Gave her name to a whole era",
		"British queen who reigned for 63 years in the 1800s"
	],
	"winston-churchill": [
		"A political leader",
		"A British statesman known for his speeches and cigars",
		"UK prime minister during World War II"
	],
	"harriet-tubman": [
		"An American heroine",
		"Escaped slavery and then went back to help others",
		"Famous conductor on the Underground Railroad"
	],
	"ada-lovelace": [
		"A pioneer of science",
		"An English mathematician and daughter of Lord Byron",
		"Often called the first computer programmer"
	],
	"marco-polo": [
		"An explorer",
		"A Venetian merchant and traveler",
		"Journeyed along the Silk Road to Kublai Khan's court"
	],
	"confucius": [
		"A thinker from the ancient world",
		"A Chinese philosopher and teacher",
		"His sayings were collected in the Analects"
	],
	"socrates": [
		"A thinker from the ancient world",
		"A Greek philosopher who wrote nothing down",
		"Teacher of Plato, sentenced to drink hemlock"
	],
	"frederick-douglass": [
		"An American leader",
		"Escaped slavery and became a famous speaker",
		"Abolitionist who wrote a celebrated autobiography"
	],
	"helen-keller": [
		"An American author and activist",
		"Lost her sight and hearing as a baby",
		"Learned to communicate with the help of Anne Sullivan"
	]
});
// src/worker/content/index.ts
var SOURCE_PACKS = {
	actors,
	"movie-characters": definePack("movie-characters", [
		[
			"darth-vader",
			"Darth Vader",
			"easy",
			["Anakin Skywalker", "Vader"],
			["sci-fi", "villain"]
		],
		[
			"luke-skywalker",
			"Luke Skywalker",
			"easy",
			[],
			["sci-fi", "hero"]
		],
		[
			"princess-leia",
			"Princess Leia",
			"easy",
			["Leia Organa"],
			["sci-fi", "hero"]
		],
		[
			"yoda",
			"Yoda",
			"easy",
			[],
			["sci-fi"]
		],
		[
			"chewbacca",
			"Chewbacca",
			"easy",
			["Chewie"],
			["sci-fi"]
		],
		[
			"harry-potter",
			"Harry Potter",
			"easy",
			[],
			["fantasy", "wizard"]
		],
		[
			"hermione-granger",
			"Hermione Granger",
			"easy",
			[],
			["fantasy", "wizard"]
		],
		[
			"gandalf",
			"Gandalf",
			"easy",
			["Gandalf the Grey"],
			["fantasy", "wizard"]
		],
		[
			"frodo-baggins",
			"Frodo Baggins",
			"easy",
			[],
			["fantasy"]
		],
		[
			"gollum",
			"Gollum",
			"easy",
			["Smeagol"],
			["fantasy"]
		],
		[
			"legolas",
			"Legolas",
			"medium",
			[],
			["fantasy", "elf"]
		],
		[
			"james-bond",
			"James Bond",
			"easy",
			["007"],
			["spy", "action"]
		],
		[
			"indiana-jones",
			"Indiana Jones",
			"easy",
			["Indy"],
			["adventure"]
		],
		[
			"jack-sparrow",
			"Captain Jack Sparrow",
			"easy",
			["Jack Sparrow"],
			["adventure", "pirate"]
		],
		[
			"batman",
			"Batman",
			"easy",
			["Bruce Wayne"],
			["superhero"]
		],
		[
			"the-joker",
			"The Joker",
			"easy",
			["Joker"],
			["villain"]
		],
		[
			"wonder-woman",
			"Wonder Woman",
			"easy",
			["Diana Prince"],
			["superhero"]
		],
		[
			"iron-man",
			"Iron Man",
			"easy",
			["Tony Stark"],
			["superhero"]
		],
		[
			"spider-man",
			"Spider-Man",
			"easy",
			["Peter Parker", "Spiderman"],
			["superhero"]
		],
		[
			"black-panther",
			"Black Panther",
			"easy",
			["T'Challa"],
			["superhero"]
		],
		[
			"the-terminator",
			"The Terminator",
			"easy",
			["Terminator", "T-800"],
			["sci-fi", "action"]
		],
		[
			"rocky-balboa",
			"Rocky Balboa",
			"easy",
			["Rocky"],
			["sports", "drama"]
		],
		[
			"forrest-gump",
			"Forrest Gump",
			"easy",
			[],
			["drama"]
		],
		[
			"et",
			"E.T.",
			"easy",
			["ET", "The Extra-Terrestrial"],
			["sci-fi", "alien"]
		],
		[
			"shrek",
			"Shrek",
			"easy",
			[],
			["animated", "ogre"]
		],
		[
			"dorothy-gale",
			"Dorothy Gale",
			"medium",
			["Dorothy"],
			["fantasy", "classic"]
		],
		[
			"willy-wonka",
			"Willy Wonka",
			"easy",
			[],
			["fantasy"]
		],
		[
			"mary-poppins",
			"Mary Poppins",
			"easy",
			[],
			["musical", "fantasy"]
		],
		[
			"elsa",
			"Elsa",
			"easy",
			["Queen Elsa"],
			["animated", "musical"]
		],
		[
			"simba",
			"Simba",
			"easy",
			[],
			["animated"]
		],
		[
			"buzz-lightyear",
			"Buzz Lightyear",
			"easy",
			[],
			["animated", "toy"]
		],
		[
			"woody",
			"Sheriff Woody",
			"easy",
			["Woody"],
			["animated", "toy"]
		],
		[
			"marty-mcfly",
			"Marty McFly",
			"medium",
			[],
			["sci-fi", "time travel"]
		],
		[
			"ellen-ripley",
			"Ellen Ripley",
			"hard",
			["Ripley"],
			["sci-fi", "horror"]
		],
		[
			"neo",
			"Neo",
			"medium",
			["Thomas Anderson"],
			["sci-fi", "action"]
		],
		[
			"katniss-everdeen",
			"Katniss Everdeen",
			"medium",
			[],
			["dystopian", "action"]
		],
		[
			"king-kong",
			"King Kong",
			"easy",
			["Kong"],
			["monster"]
		],
		[
			"godzilla",
			"Godzilla",
			"easy",
			[],
			["monster"]
		],
		[
			"jack-skellington",
			"Jack Skellington",
			"medium",
			[],
			["animated", "holiday"]
		],
		[
			"paddington-bear",
			"Paddington Bear",
			"easy",
			["Paddington"],
			["family"]
		],
		[
			"ferris-bueller",
			"Ferris Bueller",
			"hard",
			[],
			["comedy", "classic"]
		]
	], {
		"darth-vader": [
			"A villain from a space saga",
			"Wears black armor and breathes heavily",
			"Tells his son \"I am your father\""
		],
		"luke-skywalker": [
			"A hero from a space saga",
			"A farm boy who learns the ways of the Force",
			"A young Jedi who destroys the Death Star"
		],
		"princess-leia": [
			"A heroine from a space saga",
			"A rebel leader and senator",
			"Famous for her side-bun hairstyle and a hologram plea for help"
		],
		"yoda": [
			"A wise character from a space saga",
			"Small, green and over 900 years old",
			"A Jedi Master who speaks with his words in reverse order"
		],
		"chewbacca": [
			"A loyal sidekick from a space saga",
			"Tall, hairy and communicates in growls",
			"A Wookiee who co-pilots the Millennium Falcon"
		],
		"harry-potter": [
			"A hero from a fantasy series",
			"An orphan raised by his unkind aunt and uncle",
			"A boy wizard with round glasses and a lightning-bolt scar"
		],
		"hermione-granger": [
			"A heroine from a fantasy series",
			"The cleverest student in her year",
			"A witch at Hogwarts who is brilliant at spells"
		],
		"gandalf": [
			"A wise character from a fantasy epic",
			"A wizard with a long beard and a pointed hat",
			"Shouts \"You shall not pass!\" on a bridge"
		],
		"frodo-baggins": [
			"A hero from a fantasy epic",
			"A hobbit from the Shire",
			"Carries the One Ring to Mount Doom"
		],
		"gollum": [
			"A creature from a fantasy epic",
			"Pale, skinny and talks to himself",
			"Obsessed with the ring he calls \"my precious\""
		],
		"legolas": [
			"A hero from a fantasy epic",
			"An elf with long blond hair",
			"An elven archer in the Fellowship of the Ring"
		],
		"james-bond": [
			"A British movie hero",
			"A suave secret agent with a license to kill",
			"Likes his martini shaken, not stirred"
		],
		"indiana-jones": [
			"An adventure movie hero",
			"An archaeology professor who hates snakes",
			"Wears a fedora and carries a bullwhip"
		],
		"jack-sparrow": [
			"A movie adventurer",
			"A charming rogue who sails the Caribbean",
			"Captain of the Black Pearl in Pirates of the Caribbean"
		],
		"batman": [
			"A comic book hero",
			"A billionaire who fights crime at night",
			"Protects Gotham City in a cape and cowl"
		],
		"the-joker": [
			"A comic book villain",
			"A criminal clown with green hair",
			"The arch-enemy of Gotham's caped crusader"
		],
		"wonder-woman": [
			"A comic book hero",
			"An Amazon princess from Themyscira",
			"Carries a golden Lasso of Truth"
		],
		"iron-man": [
			"A comic book hero",
			"A genius inventor and billionaire",
			"Wears a red and gold armored suit"
		],
		"spider-man": [
			"A comic book hero",
			"A teenager from Queens with a secret identity",
			"Got his powers from a radioactive spider bite"
		],
		"black-panther": [
			"A comic book hero",
			"The ruler of a hidden African nation",
			"Protector of Wakanda in a vibranium suit"
		],
		"the-terminator": [
			"A sci-fi movie character",
			"A cyborg sent back in time",
			"Promises \"I'll be back\""
		],
		"rocky-balboa": [
			"A sports movie hero",
			"An underdog boxer from Philadelphia",
			"Runs up the steps of the Philadelphia Museum of Art"
		],
		"forrest-gump": [
			"A movie character",
			"A kind man from Alabama who witnesses history",
			"Says life is like a box of chocolates"
		],
		"et": [
			"A sci-fi movie character",
			"A friendly visitor stranded on Earth",
			"Wants to phone home and rides in a bike basket"
		],
		"shrek": [
			"An animated movie hero",
			"A grumpy creature who lives in a swamp",
			"A green ogre with a talking donkey sidekick"
		],
		"dorothy-gale": [
			"A classic movie heroine",
			"A farm girl from Kansas swept away by a tornado",
			"Wears ruby slippers and follows the yellow brick road"
		],
		"willy-wonka": [
			"A movie character from a children's book",
			"An eccentric candy maker",
			"Gives five golden tickets to tour his chocolate factory"
		],
		"mary-poppins": [
			"A musical movie character",
			"A magical nanny in London",
			"Flies with her umbrella and sings about a spoonful of sugar"
		],
		"elsa": [
			"An animated movie character",
			"A queen with icy powers",
			"Sings \"Let It Go\" in Frozen"
		],
		"simba": [
			"An animated movie character",
			"A lion cub who runs away from home",
			"Raised by a meerkat and a warthog, he returns to rule the Pride Lands"
		],
		"buzz-lightyear": [
			"An animated movie character",
			"A toy who believes he is a real space ranger",
			"Shouts \"To infinity and beyond!\""
		],
		"woody": [
			"An animated movie character",
			"A pull-string cowboy toy",
			"Andy's favorite toy who leads the toys in Toy Story"
		],
		"marty-mcfly": [
			"A movie character from the 1980s",
			"A teenager who rides a skateboard",
			"Travels through time in a DeLorean"
		],
		"ellen-ripley": [
			"A sci-fi movie heroine",
			"A warrant officer on a doomed spaceship",
			"Fights the xenomorph in the Alien films"
		],
		"neo": [
			"A sci-fi movie hero",
			"A hacker who learns his world is a simulation",
			"Takes the red pill in The Matrix"
		],
		"katniss-everdeen": [
			"A heroine from a book and film series",
			"An expert archer from District 12",
			"Volunteers as tribute in The Hunger Games"
		],
		"king-kong": [
			"A classic movie monster",
			"A giant ape from Skull Island",
			"Climbs the Empire State Building"
		],
		"godzilla": [
			"A classic movie monster",
			"A giant reptile from Japanese films",
			"Breathes atomic fire and stomps on Tokyo"
		],
		"jack-skellington": [
			"An animated movie character",
			"A tall, thin skeleton",
			"The skeleton who rules Halloween Town and tries to take over Christmas"
		],
		"paddington-bear": [
			"A character from books and films",
			"A polite bear from darkest Peru",
			"Loves marmalade sandwiches and wears a duffle coat"
		],
		"ferris-bueller": [
			"A movie character from the 1980s",
			"A high schooler who fakes being sick",
			"Takes a famous day off in Chicago"
		]
	}),
	"historical-figures": historicalFigures,
	"video-games": definePack("video-games", [
		[
			"mario",
			"Mario",
			"easy",
			["Super Mario"],
			["nintendo", "platformer"]
		],
		[
			"luigi",
			"Luigi",
			"easy",
			[],
			["nintendo", "platformer"]
		],
		[
			"princess-peach",
			"Princess Peach",
			"easy",
			["Peach"],
			["nintendo"]
		],
		[
			"bowser",
			"Bowser",
			"easy",
			["King Koopa"],
			["nintendo", "villain"]
		],
		[
			"link",
			"Link from The Legend of Zelda",
			"easy",
			["Link"],
			["nintendo", "adventure"]
		],
		[
			"princess-zelda",
			"Princess Zelda",
			"easy",
			["Zelda"],
			["nintendo", "adventure"]
		],
		[
			"ganondorf",
			"Ganondorf",
			"medium",
			["Ganon"],
			["nintendo", "villain"]
		],
		[
			"pikachu",
			"Pikachu",
			"easy",
			[],
			["pokemon"]
		],
		[
			"jigglypuff",
			"Jigglypuff",
			"medium",
			[],
			["pokemon"]
		],
		[
			"sonic",
			"Sonic the Hedgehog",
			"easy",
			["Sonic"],
			["sega", "platformer"]
		],
		[
			"tails",
			"Tails",
			"medium",
			["Miles Prower"],
			["sega"]
		],
		[
			"dr-eggman",
			"Dr. Eggman",
			"medium",
			["Dr. Robotnik", "Eggman"],
			["sega", "villain"]
		],
		[
			"pac-man",
			"Pac-Man",
			"easy",
			["Pacman"],
			["arcade", "classic"]
		],
		[
			"donkey-kong",
			"Donkey Kong",
			"easy",
			["DK"],
			["nintendo", "arcade"]
		],
		[
			"kirby",
			"Kirby",
			"easy",
			[],
			["nintendo"]
		],
		[
			"yoshi",
			"Yoshi",
			"easy",
			[],
			["nintendo"]
		],
		[
			"wario",
			"Wario",
			"medium",
			[],
			["nintendo"]
		],
		[
			"master-chief",
			"Master Chief",
			"easy",
			["John-117"],
			["shooter", "sci-fi"]
		],
		[
			"lara-croft",
			"Lara Croft",
			"easy",
			[],
			["adventure"]
		],
		[
			"samus-aran",
			"Samus Aran",
			"medium",
			["Samus"],
			["nintendo", "sci-fi"]
		],
		[
			"mega-man",
			"Mega Man",
			"medium",
			["Megaman", "Rockman"],
			["platformer", "classic"]
		],
		[
			"minecraft-steve",
			"Steve from Minecraft",
			"easy",
			["Steve"],
			["sandbox"]
		],
		[
			"creeper",
			"Creeper",
			"easy",
			["Minecraft Creeper"],
			["sandbox", "monster"]
		],
		[
			"kratos",
			"Kratos",
			"medium",
			[],
			["action", "mythology"]
		],
		[
			"solid-snake",
			"Solid Snake",
			"hard",
			["Snake"],
			["stealth"]
		],
		[
			"cloud-strife",
			"Cloud Strife",
			"medium",
			["Cloud"],
			["rpg"]
		],
		[
			"crash-bandicoot",
			"Crash Bandicoot",
			"easy",
			["Crash"],
			["platformer"]
		],
		[
			"spyro",
			"Spyro the Dragon",
			"medium",
			["Spyro"],
			["platformer", "dragon"]
		],
		[
			"street-fighter-ryu",
			"Ryu from Street Fighter",
			"medium",
			["Ryu"],
			["fighting"]
		],
		[
			"chun-li",
			"Chun-Li",
			"medium",
			[],
			["fighting"]
		],
		[
			"geralt",
			"Geralt of Rivia",
			"medium",
			["Geralt", "The Witcher"],
			["rpg", "fantasy"]
		],
		[
			"ezio",
			"Ezio Auditore",
			"hard",
			["Ezio"],
			["action", "history"]
		],
		[
			"tom-nook",
			"Tom Nook",
			"medium",
			[],
			["nintendo", "life sim"]
		],
		[
			"fox-mccloud",
			"Fox McCloud",
			"hard",
			[],
			["nintendo", "sci-fi"]
		],
		[
			"knuckles",
			"Knuckles the Echidna",
			"medium",
			["Knuckles"],
			["sega"]
		],
		[
			"nathan-drake",
			"Nathan Drake",
			"hard",
			[],
			["adventure"]
		],
		[
			"sora",
			"Sora from Kingdom Hearts",
			"hard",
			["Sora"],
			["rpg"]
		],
		[
			"sackboy",
			"Sackboy",
			"medium",
			[],
			["platformer"]
		],
		[
			"among-us-crewmate",
			"Among Us Crewmate",
			"easy",
			["Crewmate", "Impostor"],
			["party"]
		],
		[
			"isabelle",
			"Isabelle from Animal Crossing",
			"medium",
			["Isabelle"],
			["nintendo", "life sim"]
		]
	], {
		"mario": [
			"A video game character",
			"A plumber from the Mushroom Kingdom",
			"Nintendo's mascot in a red cap with an M on it"
		],
		"luigi": [
			"A video game character",
			"The taller, more timid of two plumber brothers",
			"Wears green and starred in a haunted mansion series"
		],
		"princess-peach": [
			"A video game character",
			"Royalty who often gets kidnapped",
			"Ruler of the Mushroom Kingdom in a pink dress"
		],
		"bowser": [
			"A video game villain",
			"A giant fire-breathing turtle",
			"Ruler of the Koopas who keeps kidnapping a princess"
		],
		"link": [
			"A video game character",
			"A silent hero in a green tunic and cap",
			"Wields the Master Sword to save Hyrule"
		],
		"princess-zelda": [
			"A video game character",
			"A princess with wisdom and magic",
			"The princess of Hyrule whose name is in her series' title"
		],
		"ganondorf": [
			"A video game villain",
			"A sorcerer who seeks the Triforce",
			"The Gerudo villain of Hyrule's legends"
		],
		"pikachu": [
			"A video game creature",
			"A small yellow electric mouse",
			"The most famous Pokémon, it says its own name"
		],
		"jigglypuff": [
			"A video game creature",
			"A round pink balloon Pokémon",
			"Sings a lullaby that puts everyone to sleep"
		],
		"sonic": [
			"A video game character",
			"A blue animal who loves chili dogs",
			"Sega's speedy hedgehog who collects gold rings"
		],
		"tails": [
			"A video game character",
			"A young fox who can fly",
			"A two-tailed fox who flies by spinning them like a propeller"
		],
		"dr-eggman": [
			"A video game villain",
			"A mad scientist with a huge mustache",
			"Builds robots to fight Sega's blue hedgehog"
		],
		"pac-man": [
			"A video game character",
			"A yellow circle from a 1980 arcade game",
			"Eats dots and runs from four ghosts in a maze"
		],
		"donkey-kong": [
			"A video game character",
			"A gorilla who wears a red necktie",
			"A Nintendo ape who threw barrels in a 1981 arcade game"
		],
		"kirby": [
			"A video game character",
			"A round pink hero from Dream Land",
			"Inhales enemies to copy their powers"
		],
		"yoshi": [
			"A video game character",
			"A friendly green dinosaur",
			"Rides with a famous plumber and eats enemies with his long tongue"
		],
		"wario": [
			"A video game character",
			"A greedy rival in yellow and purple",
			"The mischievous anti-hero with a W on his cap"
		],
		"master-chief": [
			"A video game character",
			"A super-soldier in green armor who never shows his face",
			"The Spartan hero of the Halo series"
		],
		"lara-croft": [
			"A video game character",
			"A British adventurer and archaeologist",
			"The Tomb Raider"
		],
		"samus-aran": [
			"A video game character",
			"A bounty hunter in a power suit",
			"Heroine of the Metroid series"
		],
		"mega-man": [
			"A video game character",
			"A blue robot boy with an arm cannon",
			"Fights Dr. Wily's Robot Masters and copies their weapons"
		],
		"minecraft-steve": [
			"A video game character",
			"A blocky default player character",
			"Mines and crafts in a world made of cubes"
		],
		"creeper": [
			"A video game creature",
			"A green mob that sneaks up silently",
			"Hisses and explodes in the blocky sandbox game"
		],
		"kratos": [
			"A video game character",
			"A Spartan warrior with chalk-white skin and a red tattoo",
			"The angry hero of God of War"
		],
		"solid-snake": [
			"A video game character",
			"A legendary stealth soldier",
			"Hides in a cardboard box in Metal Gear"
		],
		"cloud-strife": [
			"A video game character",
			"A mercenary with spiky blond hair and a giant sword",
			"The hero of Final Fantasy VII"
		],
		"crash-bandicoot": [
			"A video game character",
			"An orange marsupial from the 1990s",
			"Spins into crates on PlayStation platformers"
		],
		"spyro": [
			"A video game character",
			"A small purple creature from the 1990s",
			"A young dragon who breathes fire and glides"
		],
		"street-fighter-ryu": [
			"A video game character",
			"A wandering martial artist in a white gi",
			"Shouts \"Hadouken!\" when throwing a fireball"
		],
		"chun-li": [
			"A video game character",
			"A fighter famous for her lightning-fast kicks",
			"The first female fighter in Street Fighter"
		],
		"geralt": [
			"A video game character",
			"A white-haired monster hunter",
			"A sword-wielding mutant hero from Rivia"
		],
		"ezio": [
			"A video game character",
			"A hooded Italian nobleman",
			"Assassin's Creed hero from Renaissance Florence"
		],
		"tom-nook": [
			"A video game character",
			"A raccoon dog who sells you a house",
			"The shopkeeper who lends you bells for loans in Animal Crossing"
		],
		"fox-mccloud": [
			"A video game character",
			"A pilot who leads a team of animal mercenaries",
			"Flies an Arwing in Star Fox"
		],
		"knuckles": [
			"A video game character",
			"A red animal with spiked fists",
			"The echidna who guards the Master Emerald"
		],
		"nathan-drake": [
			"A video game character",
			"A charming treasure hunter",
			"Hero of the Uncharted series"
		],
		"sora": [
			"A video game character",
			"A spiky-haired boy with a giant key",
			"Fights alongside famous Disney characters in Kingdom Hearts"
		],
		"sackboy": [
			"A video game character",
			"A small knitted burlap doll",
			"Star of LittleBigPlanet"
		],
		"among-us-crewmate": [
			"A video game character",
			"A bean-shaped astronaut in a spacesuit",
			"The suspicious little spaceman from Among Us"
		],
		"isabelle": [
			"A video game character",
			"A cheerful yellow dog who works as an assistant",
			"Helps run the town hall in Animal Crossing"
		]
	}),
	"brand-mascots": brandMascots,
	"anime-cartoons": animeCartoons
};
/** Relative weights for the Mixed pack: a source pack is picked by weight, then an identity from it. */
var MIXED_WEIGHTS = {
	actors: 1,
	"movie-characters": 1.2,
	"historical-figures": 1,
	"video-games": 1,
	"brand-mascots": .6,
	"anime-cartoons": 1
};
var ALL_IDENTITIES = Object.values(SOURCE_PACKS).flat();
var BY_ID = new Map(ALL_IDENTITIES.map((i) => [i.id, i]));
function getIdentity(id) {
	const identity = BY_ID.get(id);
	if (!identity) throw new Error(`Unknown identity ${id}`);
	return identity;
}
/** All active identities a pack can produce (Mixed covers every source pack). */
function packIdentities(packId) {
	return (packId === "mixed" ? ALL_IDENTITIES : SOURCE_PACKS[packId]).filter((i) => i.active);
}
function packInfo(packId) {
	const meta = PACK_META[packId];
	return {
		id: packId,
		name: meta.name,
		description: meta.description,
		size: packIdentities(packId).length
	};
}
var RECENT_COMMANDS_KEPT = 100;
var EVENTS_KEPT = 200;
var fail = (error, message) => ({
	ok: false,
	error,
	message
});
function playerById(room, playerId) {
	return room.players.find((p) => p.id === playerId);
}
function opponentOf(room, playerId) {
	return room.players.find((p) => p.id !== playerId);
}
function isGuessing(status) {
	return status === "guessing_first" || status === "guessing_second";
}
function clone(room) {
	return structuredClone(room);
}
function emit(room, ctx, type, extra = {}) {
	room.events.push({
		type,
		at: ctx.now,
		version: room.version,
		...extra
	});
	if (room.events.length > EVENTS_KEPT) room.events.splice(0, room.events.length - EVENTS_KEPT);
}
function touch(room, ctx, activity = true) {
	room.version += 1;
	room.updatedAt = ctx.now;
	if (activity) room.lastActivityAt = ctx.now;
	syncTimer(room, ctx.now);
	return room;
}
/** Normalizes a display name for duplicate detection: case, accents, punctuation, leading "the". */
function normalizeName(name) {
	return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
}
function nameKeys(identity) {
	return [identity.canonicalName, ...identity.aliases].map(normalizeName).filter(Boolean);
}
/**
* Two identities clash if either canonical name contains the other as whole words (after normalization),
* or they share a normalized name or alias. Clashing identities are never drawn together
* or repeated as "different" identities within a match.
*/
function identitiesClash(a, b) {
	if (a.id === b.id) return true;
	const an = ` ${normalizeName(a.canonicalName)} `;
	const bn = ` ${normalizeName(b.canonicalName)} `;
	if (an.includes(bn) || bn.includes(an)) return true;
	const bKeys = new Set(nameKeys(b));
	return nameKeys(a).some((k) => bKeys.has(k));
}
/**
* The timer runs only while a timed turn is in the asking phase and both players are
* connected and looking at the game (not away). Otherwise the remaining time is frozen in `pausedRemainingMs`.
*/
function syncTimer(room, now) {
	const turn = room.turn;
	if (!turn || room.settings.timerSeconds === 0) return;
	const shouldRun = isGuessing(room.status) && turn.phase === "asking" && room.players.length === 2 && room.players.every((p) => presenceOf(p) === "here");
	if (shouldRun && turn.deadline === null && turn.pausedRemainingMs !== null) {
		turn.deadline = now + turn.pausedRemainingMs;
		turn.pausedRemainingMs = null;
	} else if (!shouldRun && turn.deadline !== null) {
		turn.pausedRemainingMs = Math.max(0, turn.deadline - now);
		turn.deadline = null;
	}
}
function pickUniform(items, random) {
	const item = items[Math.floor(random() * items.length)];
	if (item === void 0) throw new Error("pickUniform on empty list");
	return item;
}
function pickOne(candidates, settings, random) {
	if (settings.packId !== "mixed") return pickUniform(candidates, random);
	const groups = /* @__PURE__ */ new Map();
	for (const c of candidates) {
		const key = c.categoryId;
		const list = groups.get(key) ?? [];
		list.push(c);
		groups.set(key, list);
	}
	const entries = [...groups.entries()];
	const total = entries.reduce((sum, [id]) => sum + MIXED_WEIGHTS[id], 0);
	let roll = random() * total;
	for (const [id, list] of entries) {
		roll -= MIXED_WEIGHTS[id];
		if (roll < 0) return pickUniform(list, random);
	}
	return pickUniform(entries[entries.length - 1][1], random);
}
/** Which identity difficulties each level draws from. They overlap because hard identities are scarce. */
var DIFFICULTY_POOLS = {
	easy: ["easy"],
	medium: ["easy", "medium"],
	hard: ["medium", "hard"]
};
function poolFor(room, level) {
	const allowed = DIFFICULTY_POOLS[level];
	return packIdentities(room.settings.packId).filter((c) => allowed.includes(c.difficulty));
}
function drawFrom(pools, used, settings, random) {
	const unused = (pool) => pool.filter((c) => !used.some((u) => identitiesClash(c, u)));
	const firstPool = unused(pools[0]);
	if (firstPool.length === 0) return null;
	const first = pickOne(firstPool, settings, random);
	const rest = unused(pools[1]).filter((c) => !identitiesClash(c, first));
	if (rest.length === 0) return null;
	return [first, pickOne(rest, settings, random)];
}
/** Draws two distinct identities not used earlier in the match, reshuffling when the pack runs out. */
function drawPair(room, random, order = room.players.map((p) => p.id)) {
	const roomLevel = room.settings.difficulty ?? "medium";
	const levelOf = (id) => (id ? playerById(room, id)?.difficulty : null) ?? roomLevel;
	const pools = [poolFor(room, levelOf(order[0])), poolFor(room, levelOf(order[1]))];
	const pair = drawFrom(pools, room.usedIdentityIds.map(getIdentity), room.settings, random);
	if (pair) return {
		pair,
		reshuffled: false
	};
	const reshuffledPair = drawFrom(pools, [], room.settings, random);
	if (!reshuffledPair) throw new Error(`Pack ${room.settings.packId} is too small to draw a pair`);
	return {
		pair: reshuffledPair,
		reshuffled: true
	};
}
function createRoom(input, ctx) {
	const playerId = ctx.newId();
	const room = {
		schema: 1,
		roomId: input.roomId,
		code: input.code,
		hostPlayerId: playerId,
		settings: input.settings,
		status: "lobby",
		version: 1,
		players: [newPlayer(playerId, "A", input.nickname, ctx.now)],
		roundIndex: 0,
		turn: null,
		round: null,
		usedIdentityIds: [],
		lastRoundSummary: null,
		match: null,
		matchFirstPlayerId: null,
		rematchVotes: [],
		opponentLeft: false,
		recentCommands: [],
		events: [],
		createdAt: ctx.now,
		updatedAt: ctx.now,
		lastActivityAt: ctx.now
	};
	emit(room, ctx, "room.created", { playerId });
	emit(room, ctx, "player.joined", { playerId });
	return {
		room,
		playerId
	};
}
function newPlayer(id, seat, nickname, now) {
	return {
		id,
		seat,
		nickname,
		ready: false,
		connected: false,
		disconnectedAt: now,
		joinedAt: now,
		score: 0,
		correct: 0,
		skips: 0,
		hintsUsed: 0
	};
}
/** Seats a new player. Enforces the two-player cap; joining is only possible in the lobby. */
function joinRoom(current, nickname, ctx) {
	if (current.players.length >= 2) return fail("room_full", "This room already has two players.");
	if (current.status !== "lobby") return fail("room_full", "This match is already in progress.");
	const room = clone(current);
	const seat = new Set(room.players.map((p) => p.seat)).has("A") ? "B" : "A";
	const playerId = ctx.newId();
	room.players.push(newPlayer(playerId, seat, nickname, ctx.now));
	room.players.sort((a, b) => a.seat.localeCompare(b.seat));
	room.opponentLeft = false;
	touch(room, ctx);
	emit(room, ctx, "player.joined", { playerId });
	return {
		ok: true,
		room,
		playerId
	};
}
/** Records a connection change. Returns null when nothing changed. */
function setPresence(current, playerId, connected, ctx) {
	const existing = playerById(current, playerId);
	if (!existing || existing.connected === connected) return null;
	const room = clone(current);
	const player = playerById(room, playerId);
	player.connected = connected;
	player.disconnectedAt = connected ? null : ctx.now;
	player.away = false;
	player.awaySince = null;
	return touch(room, ctx, false);
}
/** Records that a connected player's page was hidden or shown again. Returns null when nothing changed. */
function setAway(current, playerId, away, ctx) {
	const existing = playerById(current, playerId);
	if (!existing || !existing.connected || (existing.away ?? false) === away) return null;
	const room = clone(current);
	const player = playerById(room, playerId);
	player.away = away;
	player.awaySince = away ? ctx.now : null;
	return touch(room, ctx, false);
}
/** Ends the current turn as timed out if its deadline has passed. Returns null otherwise. */
function expireTurn(current, ctx) {
	const turn = current.turn;
	if (!turn || !isGuessing(current.status) || turn.phase !== "asking") return null;
	if (turn.deadline === null || ctx.now < turn.deadline) return null;
	const room = clone(current);
	if (isTrade(room)) {
		touch(room, ctx, false);
		emit(room, ctx, "turn.timed_out", {
			playerId: turn.playerId,
			roundIndex: room.roundIndex
		});
		endMove(room, ctx);
		return room;
	}
	saveTrack(room, turn);
	room.round.results[turn.playerId] = "timed_out";
	playerById(room, turn.playerId).skips += 1;
	room.turn = null;
	touch(room, ctx, false);
	emit(room, ctx, "turn.timed_out", {
		playerId: turn.playerId,
		roundIndex: room.roundIndex
	});
	advanceAfterTurn(room, ctx);
	return room;
}
/** The earliest time the room needs a timer callback (turn deadline), or null. */
/** A PIN only makes sense for an occupied lobby with a free seat. */
function pinWanted(room) {
	return room.status === "lobby" && room.players.length > 0 && room.players.length < 2;
}
/** Records the room's PIN. Not player activity, so it never keeps an idle room alive. */
function withPin(current, pin, ctx) {
	const room = clone(current);
	room.pin = pin;
	return touch(room, ctx, false);
}
function nextDeadline(room) {
	return room.turn?.deadline ?? null;
}
function applyCommand(current, playerId, command, ctx) {
	if (!playerById(current, playerId)) return fail("forbidden", "You are not a player in this room.");
	if (current.recentCommands.some((c) => c.id === command.commandId && c.playerId === playerId)) return {
		ok: true,
		room: current,
		duplicate: true
	};
	if (command.expectedVersion !== current.version) return fail("version_conflict", "The game moved on. Showing the latest state.");
	const room = clone(current);
	const outcome = handlers[command.type](room, playerId, command, ctx);
	if (outcome) return outcome;
	room.recentCommands.push({
		id: command.commandId,
		playerId
	});
	if (room.recentCommands.length > RECENT_COMMANDS_KEPT) room.recentCommands.splice(0, room.recentCommands.length - RECENT_COMMANDS_KEPT);
	return {
		ok: true,
		room,
		duplicate: false
	};
}
var invalid = (message) => fail("invalid_transition", message);
function requireTurn(room) {
	if (!isGuessing(room.status) || !room.turn || !room.round) return invalid("No turn is in progress.");
	return room.turn;
}
var handlers = {
	"player.ready": (room, playerId, cmd, ctx) => {
		if (room.status !== "lobby") return invalid("You can only change readiness in the lobby.");
		playerById(room, playerId).ready = cmd.ready;
		touch(room, ctx);
		emit(room, ctx, "player.ready", { playerId });
	},
	"settings.update": (room, playerId, cmd, ctx) => {
		if (room.status !== "lobby") return invalid("Settings can only change between matches.");
		if (room.hostPlayerId !== playerId) return fail("forbidden", "Only the host can change settings.");
		room.settings = cmd.settings;
		for (const p of room.players) p.ready = false;
		touch(room, ctx);
		emit(room, ctx, "settings.updated", { playerId });
	},
	"match.start": (room, playerId, _cmd, ctx) => {
		if (room.status !== "lobby") return invalid("The match has already started.");
		if (room.hostPlayerId !== playerId) return fail("forbidden", "Only the host can start the match.");
		if (room.players.length < 2) return invalid("Waiting for a second player.");
		touch(room, ctx);
		emit(room, ctx, "match.started", { playerId });
		startMatch(room, chooseFirstFromSettings(room, ctx), ctx);
	},
	"turn.correct.request": (room, playerId, _cmd, ctx) => {
		const turn = requireTurn(room);
		if ("ok" in turn) return turn;
		if (turn.playerId !== playerId) return fail("forbidden", "It is not your turn.");
		if (turn.phase !== "asking") return invalid("Your guess is already waiting for confirmation.");
		if (isTrade(room) && hasPendingQuestion(turn)) return invalid("Wait for the answer before you guess.");
		turn.phase = "pending_confirm";
		touch(room, ctx);
		emit(room, ctx, "turn.correct.requested", {
			playerId,
			roundIndex: room.roundIndex
		});
	},
	"turn.correct.confirm": (room, playerId, _cmd, ctx) => {
		const turn = requireTurn(room);
		if ("ok" in turn) return turn;
		if (turn.playerId === playerId) return fail("forbidden", "Your opponent confirms your guess.");
		if (turn.phase !== "pending_confirm") return invalid("There is no guess to confirm.");
		scoreCorrect(room, turn, ctx);
	},
	"turn.correct.reject": (room, playerId, _cmd, ctx) => {
		const turn = requireTurn(room);
		if ("ok" in turn) return turn;
		if (turn.playerId === playerId) return fail("forbidden", "Your opponent judges your guess.");
		if (turn.phase !== "pending_confirm") return invalid("There is no guess to reject.");
		turn.phase = "asking";
		touch(room, ctx);
		emit(room, ctx, "turn.correct.rejected", {
			playerId: turn.playerId,
			roundIndex: room.roundIndex
		});
		if (isTrade(room)) endMove(room, ctx);
	},
	"turn.correct.override": (room, playerId, _cmd, ctx) => {
		const turn = requireTurn(room);
		if ("ok" in turn) return turn;
		if (room.hostPlayerId !== playerId || turn.playerId !== playerId) return fail("forbidden", "Only the host can override, on their own turn.");
		if (turn.phase !== "pending_confirm") return invalid("Request confirmation first.");
		const opponent = opponentOf(room, playerId);
		const since = opponent ? absentSince(opponent) : null;
		if (opponent && (since === null || ctx.now - since < 3e4)) return fail("forbidden", "Your opponent can still confirm.");
		scoreCorrect(room, turn, ctx);
	},
	"turn.skip": (room, playerId, _cmd, ctx) => {
		const turn = requireTurn(room);
		if ("ok" in turn) return turn;
		if (turn.playerId !== playerId) return fail("forbidden", "It is not your turn.");
		saveTrack(room, turn);
		room.round.results[playerId] = "skipped";
		playerById(room, playerId).skips += 1;
		room.turn = null;
		touch(room, ctx);
		emit(room, ctx, "turn.skipped", {
			playerId,
			roundIndex: room.roundIndex
		});
		advanceAfterTurn(room, ctx);
	},
	"turn.pass": (room, playerId, _cmd, ctx) => {
		const turn = requireTurn(room);
		if ("ok" in turn) return turn;
		if (!isTrade(room)) return invalid("This room does not trade turns.");
		if (turn.playerId !== playerId) return fail("forbidden", "It is not your turn.");
		if (turn.phase !== "asking") return invalid("A guess is waiting for confirmation.");
		if (hasPendingQuestion(turn)) return invalid("Wait for the answer before you pass.");
		touch(room, ctx);
		emit(room, ctx, "turn.passed", {
			playerId,
			roundIndex: room.roundIndex
		});
		endMove(room, ctx);
	},
	"turn.question": (room, _playerId, _cmd, ctx) => {
		const turn = requireTurn(room);
		if ("ok" in turn) return turn;
		if (room.settings.mode !== "twenty_questions") return invalid("The question counter is for Ask rooms.");
		if (turn.phase !== "asking") return invalid("A guess is waiting for confirmation.");
		if (isTrade(room) && turn.moveAsked) return invalid("One question per move.");
		turn.questionCount = Math.min(turn.questionCount + 1, 99);
		turn.moveAsked = true;
		touch(room, ctx);
	},
	"turn.ask": (room, playerId, cmd, ctx) => {
		const turn = requireTurn(room);
		if ("ok" in turn) return turn;
		if ((room.settings.questions ?? "both") === "spoken") return invalid("This room asks questions out loud.");
		if (turn.playerId !== playerId) return fail("forbidden", "Only the guesser asks questions.");
		if (turn.phase !== "asking") return invalid("A guess is waiting for confirmation.");
		if (hasPendingQuestion(turn)) return invalid("Wait for the answer before asking another question.");
		if (isTrade(room) && turn.moveAsked) return invalid("One question per move.");
		const sends = room.questionSends ??= {};
		const recent = (sends[playerId] ?? []).filter((t) => ctx.now - t < QUESTION_RATE_LIMIT.windowMs);
		if (recent.length >= QUESTION_RATE_LIMIT.limit) return fail("rate_limited", "Slow down a little before the next question.");
		sends[playerId] = [...recent, ctx.now];
		turn.log.push({
			id: ctx.newId(),
			kind: "question",
			text: cmd.text,
			answer: null,
			at: ctx.now
		});
		turn.questionCount = Math.min(turn.questionCount + 1, 99);
		turn.moveAsked = true;
		touch(room, ctx);
		emit(room, ctx, "turn.question.asked", {
			playerId,
			roundIndex: room.roundIndex
		});
	},
	"turn.answer": (room, playerId, cmd, ctx) => {
		const turn = requireTurn(room);
		if ("ok" in turn) return turn;
		if (turn.playerId === playerId) return fail("forbidden", "Your opponent answers your questions.");
		const entry = turn.log.find((e) => e.id === cmd.questionId);
		if (!entry || entry.kind !== "question") return invalid("That question is not part of this turn.");
		if (entry.answer !== null) return invalid("That question was already answered.");
		entry.answer = cmd.answer;
		touch(room, ctx);
		emit(room, ctx, "turn.question.answered", {
			playerId,
			roundIndex: room.roundIndex
		});
	},
	"turn.hint": (room, playerId, _cmd, ctx) => {
		const turn = requireTurn(room);
		if ("ok" in turn) return turn;
		if (room.settings.hints === false) return invalid("Hints are turned off in this room.");
		if (turn.playerId !== playerId) return fail("forbidden", "Only the guesser can ask for a hint.");
		if (turn.phase !== "asking") return invalid("A guess is waiting for confirmation.");
		if (turn.hintsUsed >= 3) return invalid("No more hints this turn.");
		const identity = getIdentity(room.round.assignments[playerId]);
		const index = turn.hintsUsed;
		turn.hintsUsed += 1;
		turn.log.push({
			id: ctx.newId(),
			kind: "hint",
			index: index + 1,
			text: identity.hints[index],
			at: ctx.now
		});
		room.round.hintsUsed[playerId] = (room.round.hintsUsed[playerId] ?? 0) + 1;
		playerById(room, playerId).hintsUsed += 1;
		touch(room, ctx);
		emit(room, ctx, "turn.hint.revealed", {
			playerId,
			roundIndex: room.roundIndex
		});
	},
	"round.next": (room, _playerId, _cmd, ctx) => {
		if (room.status !== "round_summary") return invalid("The round is not over yet.");
		if (room.lastRoundSummary?.matchOver) {
			room.status = "match_summary";
			touch(room, ctx);
			emit(room, ctx, "match.completed", { roundIndex: room.roundIndex });
			return;
		}
		touch(room, ctx);
		startRound(room, ctx);
	},
	"match.rematch": (room, playerId, _cmd, ctx) => {
		if (room.status !== "match_summary") return invalid("The match is not over.");
		if (room.rematchVotes.includes(playerId)) return invalid("You already asked for a rematch.");
		room.rematchVotes.push(playerId);
		touch(room, ctx);
		if (room.players.length === 2 && room.players.every((p) => room.rematchVotes.includes(p.id))) {
			emit(room, ctx, "match.rematched", { playerId });
			startMatch(room, rematchFirstPlayer(room), ctx, { keepUsedIdentities: true });
		}
	},
	"match.change_settings": (room, playerId, _cmd, ctx) => {
		if (room.status !== "match_summary") return invalid("The match is not over.");
		resetToLobby(room);
		touch(room, ctx);
		emit(room, ctx, "settings.updated", { playerId });
	},
	"player.leave": (room, playerId, _cmd, ctx) => {
		room.players = room.players.filter((p) => p.id !== playerId);
		if (room.hostPlayerId === playerId && room.players[0]) room.hostPlayerId = room.players[0].id;
		if (room.status !== "lobby") resetToLobby(room);
		for (const p of room.players) p.ready = false;
		room.opponentLeft = room.players.length > 0;
		touch(room, ctx);
		emit(room, ctx, "player.left", { playerId });
	},
	"player.difficulty": (room, playerId, cmd, ctx) => {
		if (room.status !== "lobby") return invalid("Difficulty can only change between matches.");
		playerById(room, playerId).difficulty = cmd.difficulty;
		touch(room, ctx);
	},
	"player.remove": (room, playerId, cmd, ctx) => {
		if (room.status !== "lobby") return invalid("Players can only be removed in the lobby.");
		if (room.hostPlayerId !== playerId) return fail("forbidden", "Only the host can remove a player.");
		if (cmd.playerId === playerId || !playerById(room, cmd.playerId)) return invalid("That player cannot be removed.");
		room.players = room.players.filter((p) => p.id !== cmd.playerId);
		for (const p of room.players) p.ready = false;
		room.removedPlayerIds = [...room.removedPlayerIds ?? [], cmd.playerId].slice(-20);
		touch(room, ctx);
		emit(room, ctx, "player.left", { playerId: cmd.playerId });
	}
};
function resetToLobby(room) {
	room.status = "lobby";
	room.turn = null;
	room.round = null;
	room.roundIndex = 0;
	room.usedIdentityIds = [];
	room.lastRoundSummary = null;
	room.match = null;
	room.rematchVotes = [];
	for (const p of room.players) {
		p.ready = false;
		resetStats(p);
	}
}
function resetStats(p) {
	p.score = 0;
	p.correct = 0;
	p.skips = 0;
	p.hintsUsed = 0;
}
function chooseFirstFromSettings(room, ctx) {
	const host = room.hostPlayerId;
	const other = opponentOf(room, host).id;
	switch (room.settings.firstPlayer ?? "random") {
		case "host": return host;
		case "opponent": return other;
		default: return ctx.random() < .5 ? host : other;
	}
}
/** The loser of the previous match goes first; after a tie, whoever went second in its round 1. */
function rematchFirstPlayer(room) {
	const previous = room.match;
	const previousFirst = room.matchFirstPlayerId ?? room.hostPlayerId;
	if (previous && !previous.tie && previous.winnerId) return opponentOf(room, previous.winnerId).id;
	return opponentOf(room, previousFirst).id;
}
/** Resets scores and the shuffle, then starts round 1 with `firstPlayerId` guessing first. */
function startMatch(room, firstPlayerId, ctx, opts = {}) {
	for (const p of room.players) resetStats(p);
	if (!opts.keepUsedIdentities) room.usedIdentityIds = [];
	room.roundIndex = 0;
	room.match = null;
	room.lastRoundSummary = null;
	room.opponentLeft = false;
	room.rematchVotes = [];
	room.matchFirstPlayerId = firstPlayerId;
	startRound(room, ctx);
}
/** First guesser of a round: the match starter in odd rounds, the other player in even rounds. */
function firstGuesserOf(room, roundIndex) {
	const starter = room.matchFirstPlayerId ?? room.hostPlayerId;
	return roundIndex % 2 === 1 ? starter : opponentOf(room, starter).id;
}
function scoreCorrect(room, turn, ctx) {
	const guesser = playerById(room, turn.playerId);
	saveTrack(room, turn);
	guesser.score += 1;
	guesser.correct += 1;
	room.round.results[guesser.id] = "correct";
	room.turn = null;
	touch(room, ctx);
	emit(room, ctx, "turn.correct.confirmed", {
		playerId: guesser.id,
		roundIndex: room.roundIndex
	});
	advanceAfterTurn(room, ctx);
}
function startRound(room, ctx) {
	room.status = "assigning";
	room.roundIndex += 1;
	const first = firstGuesserOf(room, room.roundIndex);
	const second = opponentOf(room, first).id;
	const { pair, reshuffled } = drawPair(room, ctx.random, [first, second]);
	if (reshuffled) room.usedIdentityIds = [];
	room.usedIdentityIds.push(pair[0].id, pair[1].id);
	room.round = {
		index: room.roundIndex,
		assignments: {
			[first]: pair[0].id,
			[second]: pair[1].id
		},
		results: {},
		hintsUsed: {},
		reshuffled,
		order: [first, second]
	};
	room.lastRoundSummary = null;
	emit(room, ctx, "round.started", {
		roundIndex: room.roundIndex,
		playerId: first
	});
	beginTurn(room, playerById(room, first), "guessing_first", ctx);
}
function beginTurn(room, player, status, ctx) {
	room.status = status;
	const track = room.round?.tracks?.[player.id];
	room.turn = {
		id: `${room.roundIndex}-${player.seat}-${room.version}`,
		playerId: player.id,
		phase: "asking",
		deadline: null,
		pausedRemainingMs: room.settings.timerSeconds > 0 ? room.settings.timerSeconds * 1e3 : null,
		questionCount: track?.questionCount ?? 0,
		hintsUsed: track?.hintsUsed ?? 0,
		log: track?.log ?? [],
		moveAsked: false
	};
	syncTimer(room, ctx.now);
}
function isTrade(room) {
	return room.settings.turnFormat === "trade" && room.settings.mode === "twenty_questions";
}
function hasPendingQuestion(turn) {
	return turn.log.some((e) => e.kind === "question" && e.answer === null);
}
function saveTrack(room, turn) {
	(room.round.tracks ??= {})[turn.playerId] = {
		log: turn.log,
		questionCount: turn.questionCount,
		hintsUsed: turn.hintsUsed
	};
}
/** Starts the move of whoever is still in the round, or the same player if their opponent gave up. */
function beginMove(room, playerId, ctx) {
	const round = room.round;
	beginTurn(room, playerById(room, playerId), playerId === round.order[0] ? "guessing_first" : "guessing_second", ctx);
}
function endMove(room, ctx) {
	const turn = room.turn;
	const round = room.round;
	saveTrack(room, turn);
	const other = round.order.find((id) => id !== turn.playerId);
	room.turn = null;
	beginMove(room, round.results[other] ? turn.playerId : other, ctx);
}
function advanceAfterTurn(room, ctx) {
	if (isTrade(room)) {
		const round = room.round;
		const remaining = round.order.find((id) => !round.results[id]);
		if (remaining && !Object.values(round.results).includes("correct")) beginMove(room, remaining, ctx);
		else completeRound(room, ctx);
		return;
	}
	if (room.status === "guessing_first") {
		beginTurn(room, playerById(room, room.round.order[1]), "guessing_second", ctx);
		return;
	}
	completeRound(room, ctx);
}
function completeRound(room, ctx) {
	const round = room.round;
	const scores = room.players.map((p) => p.score);
	const matchOver = room.settings.matchType === "points" ? Math.max(...scores) >= 5 : room.roundIndex >= 10;
	room.lastRoundSummary = {
		roundIndex: round.index,
		entries: room.players.map((p) => ({
			playerId: p.id,
			identityId: round.assignments[p.id],
			result: round.results[p.id] ?? (Object.values(round.results).includes("correct") ? "beaten" : "skipped"),
			hintsUsed: round.hintsUsed?.[p.id] ?? 0,
			questions: round.tracks?.[p.id]?.questionCount ?? 0,
			level: p.difficulty ?? room.settings.difficulty ?? "medium"
		})),
		matchOver
	};
	if (matchOver) {
		const [first, second] = [...room.players].sort((x, y) => y.score - x.score);
		const tie = !!first && !!second && first.score === second.score;
		room.match = {
			winnerId: tie || !first ? null : first.id,
			tie,
			rounds: room.roundIndex
		};
	}
	room.status = "round_summary";
	room.turn = null;
	room.round = null;
	emit(room, ctx, "round.completed", { roundIndex: round.index });
}
// src/worker/view.ts
function publicIdentity$1(identityId) {
	const identity = getIdentity(identityId);
	return {
		id: identity.id,
		canonicalName: identity.canonicalName,
		categoryId: identity.categoryId
	};
}
function viewFor(room, viewerId, now) {
	if (!playerById(room, viewerId)) throw new Error("viewFor called for a player not in the room");
	const opponent = opponentOf(room, viewerId);
	const opponentIdentityId = isGuessing(room.status) && room.round && opponent ? room.round.assignments[opponent.id] : void 0;
	const showSummary = room.status === "round_summary" || room.status === "match_summary";
	const notices = [];
	if (isGuessing(room.status) && room.round?.reshuffled) notices.push("pack_reshuffled");
	if (room.status === "lobby" && room.opponentLeft) notices.push("opponent_left");
	return {
		code: room.code,
		pin: room.pin?.value ?? null,
		version: room.version,
		serverNow: now,
		status: room.status,
		settings: room.settings,
		pack: packInfo(room.settings.packId),
		youId: viewerId,
		hostPlayerId: room.hostPlayerId,
		players: room.players.map((p) => ({
			playerId: p.id,
			seat: p.seat,
			nickname: p.nickname,
			ready: p.ready,
			connected: p.connected,
			disconnectedAt: p.disconnectedAt,
			away: p.connected && (p.away ?? false),
			awaySince: p.connected && p.away ? p.awaySince ?? null : null,
			isHost: p.id === room.hostPlayerId,
			score: p.score,
			correct: p.correct,
			skips: p.skips,
			hintsUsed: p.hintsUsed ?? 0,
			difficulty: p.difficulty ?? null
		})),
		roundIndex: room.roundIndex,
		firstPlayerId: room.round?.order[0] ?? null,
		turn: room.turn ? {
			playerId: room.turn.playerId,
			phase: room.turn.phase,
			deadline: room.turn.deadline,
			pausedRemainingMs: room.turn.pausedRemainingMs,
			questionCount: room.turn.questionCount,
			hintsUsed: room.turn.hintsUsed ?? 0,
			log: (room.turn.log ?? []).map((entry) => ({ ...entry })),
			moveAsked: room.turn.moveAsked ?? false
		} : null,
		turnResults: room.round ? { ...room.round.results } : {},
		opponentIdentity: opponentIdentityId ? publicIdentity$1(opponentIdentityId) : null,
		roundSummary: showSummary && room.lastRoundSummary ? {
			roundIndex: room.lastRoundSummary.roundIndex,
			matchOver: room.lastRoundSummary.matchOver,
			entries: room.lastRoundSummary.entries.map((e) => ({
				playerId: e.playerId,
				result: e.result,
				hintsUsed: e.hintsUsed ?? 0,
				identity: publicIdentity$1(e.identityId)
			}))
		} : null,
		matchSummary: room.status === "match_summary" && room.match ? { ...room.match } : null,
		rematchVotes: room.status === "match_summary" ? [...room.rematchVotes ?? []] : [],
		rematchFirstPlayerId: room.status === "match_summary" && room.players.length === 2 ? rematchFirstPlayer(room) : null,
		notices
	};
}
/** Public room info for the join screen. Contains no identities and no player ids. */
function previewOf(room) {
	const host = playerById(room, room.hostPlayerId);
	return {
		code: room.code,
		status: room.status,
		settings: room.settings,
		pack: packInfo(room.settings.packId),
		hostNickname: host?.nickname ?? null,
		playerCount: room.players.length,
		full: room.players.length >= 2 || room.status !== "lobby"
	};
}
// src/party/manifest.ts
/**
* How long a match runs in a party room. The game's own site offers first to 5 points or the best
* after 10 rounds; a party room adds first to 3, its default, so one game does not hold the room
* for the whole night.
*/
var MATCH_LENGTHS = [
	"first_to_3",
	"first_to_5",
	"rounds_10"
];
var MODE_OPTIONS = [{
	value: "twenty_questions",
	label: "Ask"
}, {
	value: "describe_it",
	label: "Clues"
}];
var TURN_FORMAT_OPTIONS = [{
	value: "trade",
	label: "Trade turns"
}, {
	value: "keep_going",
	label: "Keep going"
}];
var QUESTION_OPTIONS = [
	{
		value: "both",
		label: "Out loud or typed"
	},
	{
		value: "spoken",
		label: "Out loud"
	},
	{
		value: "app",
		label: "Typed"
	}
];
var DIFFICULTY_LABELS = {
	easy: "Easy",
	medium: "Medium",
	hard: "Hard"
};
var manifest = {
	id: "who-am-i",
	name: "Who Am I?",
	blurb: "Guess the secret identity only your friend can see",
	/** The same on every site, so a link works on any host. */
	path: "/who-am-i/",
	players: {
		min: 2,
		max: 2,
		solo: false
	},
	/**
	* A party larger than two may vote for it: the room chooses its two players on spots, and
	* everyone else in the party watches as its audience, who see both identities (KR-12).
	*/
	audience: true,
	devices: {
		phone: true,
		desktop: false,
		sharedScreen: true,
		sideways: false,
		upright: true
	},
	/**
	* For a party room: the module, under `path`, whose mount() shows a match the room has already
	* started for its two seats. It shows the game's own page (index.html beside it) in a frame.
	*/
	lobby: { view: "party-view/view.js" },
	/** The choices for a party room's settings step (the kit's `manifest.settings`). */
	settings: [
		{
			key: "packId",
			label: "Category",
			options: PACK_ORDER.map((id) => ({
				value: id,
				label: PACK_META[id].name
			})),
			default: "mixed"
		},
		{
			key: "mode",
			label: "Mode",
			options: MODE_OPTIONS,
			default: "twenty_questions"
		},
		{
			key: "turnFormat",
			label: "Turns",
			options: TURN_FORMAT_OPTIONS,
			default: "trade"
		},
		{
			key: "questions",
			label: "Questions",
			options: QUESTION_OPTIONS,
			default: "both"
		},
		{
			key: "timerSeconds",
			label: "Turn timer",
			options: [
				{
					value: 0,
					label: "No timer"
				},
				{
					value: 60,
					label: "60 seconds"
				},
				{
					value: 90,
					label: "90 seconds"
				}
			],
			default: 0
		},
		{
			key: "hints",
			label: "Hints",
			options: [{
				value: true,
				label: "On"
			}, {
				value: false,
				label: "Off"
			}],
			default: true
		},
		{
			key: "difficulty",
			label: "Difficulty",
			options: DIFFICULTIES.map((d) => ({
				value: d,
				label: DIFFICULTY_LABELS[d]
			})),
			default: "medium"
		},
		{
			key: "match",
			label: "Match",
			options: [
				{
					value: "first_to_3",
					label: "First to 3"
				},
				{
					value: "first_to_5",
					label: "First to 5"
				},
				{
					value: "rounds_10",
					label: "Best of 10 rounds"
				}
			],
			default: "first_to_3"
		}
	],
	/**
	* What a browser loads, relative to this package, copied under `path` by the host's build:
	* the built room view (`npm run build:party`), and nothing else. It holds no identity
	* content (scripts/check-bundle.mjs).
	*/
	public: [{
		from: "party-view",
		to: "party-view"
	}]
};
// src/party/game.ts
/** A room is deleted after this long without any player activity: two locked phones must not lose the game. */
var ROOM_IDLE_MS = 36e5;
var cryptoSources = {
	random: () => {
		const buf = /* @__PURE__ */ new Uint32Array(1);
		crypto.getRandomValues(buf);
		return buf[0] / 2 ** 32;
	},
	newId: () => crypto.randomUUID()
};
function context(now, sources) {
	return {
		now,
		random: () => sources.random(),
		newId: () => sources.newId()
	};
}
var rules = {
	/** A new room with its host in the lobby. */
	open(input, now, sources = cryptoSources) {
		return createRoom(input, context(now, sources));
	},
	/** Seats a second player in the lobby. */
	join(room, nickname, now, sources = cryptoSources) {
		return joinRoom(room, nickname, context(now, sources));
	},
	/** Validates and applies one command. A repeated command id is answered, never applied again. */
	command(room, playerId, command, now, sources = cryptoSources) {
		return applyCommand(room, playerId, command, context(now, sources));
	},
	/** Ends the current turn if its deadline has passed. Null when nothing changed. */
	tick(room, now, sources = cryptoSources) {
		return expireTurn(room, context(now, sources));
	},
	/** When the room next needs waking for the rules (a turn deadline), or null. */
	nextDeadline(room) {
		return nextDeadline(room);
	},
	/**
	* Records a player's connection and, while connected, whether they are away. Either pauses the
	* turn timer and counts towards the host override. Null when nothing changed.
	*/
	presence(room, playerId, report, now, sources = cryptoSources) {
		const ctx = context(now, sources);
		const connected = setPresence(room, playerId, report.connected, ctx);
		if (!report.connected) return connected;
		return setAway(connected ?? room, playerId, report.away, ctx) ?? connected;
	},
	/** What one player may see: never the identity they are guessing before their round is over. */
	view(room, playerId, now) {
		return viewFor(room, playerId, now);
	},
	/** What the join screen may see: no identities, no player ids. */
	preview(room) {
		return previewOf(room);
	},
	player(room, playerId) {
		return playerById(room, playerId);
	},
	/** Own-site hosting only: a PIN makes sense for an occupied lobby with a free seat. */
	pinWanted(room) {
		return pinWanted(room);
	},
	/** Own-site hosting only: records the room's PIN, which is not player activity. */
	withPin(room, pin, now, sources = cryptoSources) {
		return withPin(room, pin, context(now, sources));
	}
};
/** In a party room the kit owns the lobby, settings, seats and rematches; the game takes only the match. */
var PARTY_COMMANDS = /* @__PURE__ */ new Set([
	"turn.correct.request",
	"turn.correct.confirm",
	"turn.correct.reject",
	"turn.correct.override",
	"turn.skip",
	"turn.pass",
	"turn.question",
	"turn.ask",
	"turn.answer",
	"turn.hint",
	"round.next"
]);
/** A party seat's player id. Seat numbers are public in the room, so the id carries nothing new. */
var playerOf$1 = (seat) => `seat-${seat}`;
function seatOf(state, playerId) {
	return state.seats.find((s) => playerOf$1(s) === playerId) ?? null;
}
function knownIdentity(id) {
	try {
		getIdentity(id);
		return true;
	} catch {
		return false;
	}
}
function mustApply(room, playerId, type, ctx) {
	const result = applyCommand(room, playerId, {
		type,
		commandId: `party-${type}-${playerId}`,
		expectedVersion: room.version
	}, ctx);
	if (!result.ok) throw new Error(`${type} failed: ${result.message}`);
	return result.room;
}
function sameSeats(a, b) {
	return a.length === b.length && a.every((s) => b.includes(s));
}
var game$1 = {
	id: manifest.id,
	minSeats: 2,
	maxSeats: 2,
	/** Turn-based: no tick loop. The room wakes at `nextDeadline` and calls `tick` (KR-2). */
	tickHz: 0,
	/** Nobody can stand in: a bot cannot see your identity and answer your questions (KR-4). */
	bots: false,
	/** A dropped or locked phone keeps its seat while the room lives; the timer pauses meanwhile (KR-4). */
	reconnectGraceMs: Infinity,
	/** KR-6. */
	idleShutdownMs: ROOM_IDLE_MS,
	staleRoomMs: ROOM_IDLE_MS,
	/** The room's seed must stay out of every client's view (KR-1). Identities never come from it anyway. */
	privateSeed: true,
	/** A screen may join: its snapshot holds no identity (KR-1). */
	screens: true,
	/** Checks the host's settings from the lobby (KR-8). Missing settings mean the defaults. */
	settings(value) {
		const parsed = SettingsSchema.safeParse(value ?? DEFAULT_SETTINGS);
		return parsed.success ? {
			ok: true,
			settings: parsed.data
		} : {
			ok: false,
			error: "bad_request",
			message: parsed.error.issues[0]?.message ?? "Invalid settings."
		};
	},
	/**
	* A match begins with the party's two seats, both connected (they just voted). The first seat
	* is the engine's host; in a party room that means nothing a player sees (either guesser may
	* confirm their own guess when the other phone is gone: overrideAsGuesser). With a carry from the same two seats it starts as a rematch: the loser guesses first and the
	* last match's identities stay out of the draw.
	*/
	create(input) {
		const { now, sources = cryptoSources } = input;
		if (input.seats.length !== 2) throw new Error("Who Am I? takes exactly two seats");
		const checked = game$1.settings(input.settings);
		if (!checked.ok) throw new Error(checked.message);
		const [first, second] = [...input.seats].sort((x, y) => x.seat - y.seat);
		const seats = [first.seat, second.seat];
		const ctx = context(now, sources);
		const host = playerOf$1(first.seat);
		const guest = playerOf$1(second.seat);
		let room = createRoom({
			roomId: sources.newId(),
			code: "",
			nickname: first.name,
			settings: checked.settings
		}, {
			...ctx,
			newId: () => host
		}).room;
		const joined = joinRoom(room, second.name, {
			...ctx,
			newId: () => guest
		});
		if (!joined.ok) throw new Error(joined.message);
		room = setPresence(joined.room, host, true, ctx) ?? joined.room;
		room = setPresence(room, guest, true, ctx) ?? room;
		const carry = input.carry;
		if (carry && sameSeats(carry.seats, seats)) {
			room = structuredClone(room);
			room.status = "match_summary";
			room.match = {
				winnerId: carry.winnerSeat === null ? null : playerOf$1(carry.winnerSeat),
				tie: carry.tie,
				rounds: 0
			};
			room.matchFirstPlayerId = playerOf$1(carry.firstSeat);
			room.usedIdentityIds = carry.usedIdentityIds.filter(knownIdentity);
			room = mustApply(room, host, "match.rematch", ctx);
			room = mustApply(room, guest, "match.rematch", ctx);
		} else room = mustApply(room, host, "match.start", ctx);
		return {
			room,
			seats
		};
	},
	/**
	* One command from a seat, answered ok or with a clear error (KR-7). A turn whose deadline has
	* passed ends first, so the first valid move wins; the room sends fresh snapshots after every
	* input, answered either way.
	*/
	input(state, seat, data, now, sources = cryptoSources) {
		if (!state.seats.includes(seat)) return {
			ok: false,
			error: "forbidden",
			message: "That seat is not playing this game."
		};
		const parsed = CommandSchema.safeParse(data);
		if (!parsed.success) return {
			ok: false,
			error: "bad_request",
			message: parsed.error.issues[0]?.message ?? "Invalid command."
		};
		if (!PARTY_COMMANDS.has(parsed.data.type)) return {
			ok: false,
			error: "forbidden",
			message: "The party room does that, not the game."
		};
		game$1.tick(state, now, sources);
		const playerId = playerOf$1(seat);
		const result = parsed.data.type === "turn.correct.override" ? overrideAsGuesser(state.room, playerId, parsed.data, now, sources) : rules.command(state.room, playerId, parsed.data, now, sources);
		if (!result.ok) return result;
		state.room = result.room;
		return {
			ok: true,
			duplicate: result.duplicate
		};
	},
	/** KR-1: a player sees their own filtered view; a screen, or a seat not in this game, sees the screen view. */
	snapshot(state, now, viewer) {
		if (viewer.role === "player" && state.seats.includes(viewer.seat)) return rules.view(state.room, playerOf$1(viewer.seat), now);
		return screenView(state, now);
	},
	nextDeadline(state) {
		return rules.nextDeadline(state.room);
	},
	/** Called by the room's alarm at `nextDeadline`. Returns events for everyone; none carries an identity. */
	tick(state, now, sources = cryptoSources) {
		const timedOut = state.room.turn?.playerId;
		const next = rules.tick(state.room, now, sources);
		if (!next) return [];
		state.room = next;
		const seat = seatOf(state, timedOut);
		return seat === null ? [] : [{
			k: "timed_out",
			seat
		}];
	},
	/** KR-4 and KR-5. Returns whether anything changed. */
	presence(state, seat, report, now, sources = cryptoSources) {
		if (!state.seats.includes(seat)) return false;
		const next = rules.presence(state.room, playerOf$1(seat), report, now, sources);
		if (!next) return false;
		state.room = next;
		return true;
	},
	isOver(state) {
		return state.room.status === "match_summary" && state.room.match !== null;
	},
	result(state) {
		const { room } = state;
		if (!game$1.isOver(state) || !room.match) return null;
		return {
			winnerSeat: seatOf(state, room.match.winnerId),
			tie: room.match.tie,
			rounds: room.match.rounds,
			scores: state.seats.map((seat) => ({
				seat,
				score: playerById(room, playerOf$1(seat))?.score ?? 0
			}))
		};
	},
	/** Places for the party room's night score: the winner first, both first after a tie. */
	standings(state) {
		const result = game$1.result(state);
		if (!result) return [];
		const sorted = [...result.scores].sort((x, y) => y.score - x.score);
		return sorted.map((row) => ({
			seat: row.seat,
			place: 1 + sorted.filter((other) => other.score > row.score).length
		}));
	},
	/** What the next match between the same two seats starts from (KR-8). Server-only: it names identities. */
	carry(state) {
		const { room } = state;
		const result = game$1.result(state);
		const firstSeat = seatOf(state, room.matchFirstPlayerId);
		if (!result || firstSeat === null) return null;
		return {
			seats: [...state.seats],
			usedIdentityIds: [...room.usedIdentityIds],
			winnerSeat: result.winnerSeat,
			tie: result.tie,
			firstSeat
		};
	},
	/** KR-3: saved after every input and restored on wake. */
	serialize(state) {
		return JSON.stringify(state);
	},
	restore(text) {
		const state = JSON.parse(text);
		const seats = state.seats;
		if (!state.room || state.room.schema !== 1 || !Array.isArray(seats) || seats.length !== 2 || !seats.every(Number.isInteger)) throw new Error("Not a saved Who Am I? game");
		return {
			room: state.room,
			seats: [seats[0], seats[1]]
		};
	}
};
/**
* "Confirm my own guess": on the game's own site only the room's host may, because the host made
* the room. In a party room neither player made it, so either guesser may, on the same terms
* (their own turn, a guess waiting, the other phone gone or hidden for 30 seconds). The engine
* checks those terms with the guesser standing in as host for this one command, and the host is
* put back after, so nothing else changes hands.
*/
function overrideAsGuesser(room, playerId, command, now, sources) {
	const host = room.hostPlayerId;
	if (host === playerId || room.turn?.playerId !== playerId) return rules.command(room, playerId, command, now, sources);
	const result = rules.command({
		...room,
		hostPlayerId: playerId
	}, playerId, command, now, sources);
	if (!result.ok) return result;
	return {
		...result,
		room: {
			...result.room,
			hostPlayerId: host
		}
	};
}
function screenView(state, now) {
	const { room } = state;
	const turn = room.turn;
	const turnSeat = seatOf(state, turn?.playerId);
	return {
		role: "screen",
		version: room.version,
		serverNow: now,
		status: room.status,
		roundIndex: room.roundIndex,
		players: state.seats.map((seat) => ({
			seat,
			name: playerById(room, playerOf$1(seat))?.nickname ?? ""
		})),
		turn: turn && turnSeat !== null ? {
			seat: turnSeat,
			phase: turn.phase,
			deadline: turn.deadline,
			pausedRemainingMs: turn.pausedRemainingMs,
			questionCount: turn.questionCount
		} : null
	};
}
// src/party/room-game.ts
/** The host's choices in a party room, as the settings step hands them over. Every field has a default. */
var RoomSettingsSchema = z.object({
	packId: z.enum(PACK_IDS).default("mixed"),
	mode: z.enum(MODES).default("twenty_questions"),
	turnFormat: z.enum(TURN_FORMATS).default("trade"),
	questions: z.enum(QUESTION_MODES).default("both"),
	timerSeconds: z.union([
		z.literal(0),
		z.literal(60),
		z.literal(90)
	]).default(0),
	hints: z.boolean().default(true),
	difficulty: z.enum(DIFFICULTIES).default("medium"),
	match: z.enum(MATCH_LENGTHS).default("first_to_3")
});
/**
* How long a dropped phone's seat is held before the room gives up on it (`game.reconnectGraceMs`):
* a player gone for a minute forfeits (the owner's rule, 2026-11-15).
*/
var RECONNECT_GRACE_MS = 6e4;
/**
* How long a player must have been gone (dropped, or their page hidden) before the other leaving
* the party no longer hands them the win: the same 30 seconds after which the guesser may confirm
* their own guess without them, half the minute after which a dropped phone forfeits.
*/
var ABSENT_MS = HOST_OVERRIDE_AFTER_MS;
/** The game's own settings and the match target for a room's choices. */
function engineSettings(settings) {
	const { match, ...rest } = settings;
	return {
		settings: {
			...rest,
			matchType: match === "rounds_10" ? "rounds" : "points",
			firstPlayer: "random"
		},
		pointsToWin: match === "first_to_3" ? 3 : null
	};
}
var playerOf = (seat) => `seat-${seat}`;
/** A party name as the engine's own nickname rule has it; a name it refuses becomes "Player". */
function nicknameOf(name) {
	const parsed = NicknameSchema.safeParse(typeof name === "string" ? name : "");
	return parsed.success ? parsed.data : "Player";
}
/** A carry as this game writes it, or null for anything else (it comes back from the room's storage). */
function carryOf(value) {
	if (!value || typeof value !== "object") return null;
	const c = value;
	const seat = (s) => Number.isInteger(s);
	if (!Array.isArray(c.seats) || c.seats.length !== 2 || !c.seats.every(seat)) return null;
	if (!Array.isArray(c.usedIdentityIds) || !c.usedIdentityIds.every((id) => typeof id === "string")) return null;
	if (!(c.winnerSeat === null || seat(c.winnerSeat)) || typeof c.tie !== "boolean" || !seat(c.firstSeat)) return null;
	return {
		seats: [c.seats[0], c.seats[1]],
		usedIdentityIds: c.usedIdentityIds,
		winnerSeat: c.winnerSeat,
		tie: c.tie,
		firstSeat: c.firstSeat
	};
}
/**
* The engine ends a points match at 5. A party room's first to 3 ends it at the end of the round
* that reaches 3, the same way the engine ends one at 5: the round's summary says the match is
* over, and the next tap there shows the match summary, where the room takes over.
*/
function applyTarget(state) {
	const room = state.match.room;
	const target = state.pointsToWin;
	if (target === null || room.settings.matchType !== "points") return;
	if (room.status !== "round_summary" || !room.lastRoundSummary || room.lastRoundSummary.matchOver) return;
	if (Math.max(...room.players.map((p) => p.score)) < target) return;
	const next = structuredClone(room);
	next.lastRoundSummary.matchOver = true;
	const [first, second] = [...next.players].sort((x, y) => y.score - x.score);
	const tie = !!first && !!second && first.score === second.score;
	next.match = {
		winnerId: tie || !first ? null : first.id,
		tie,
		rounds: next.roundIndex
	};
	state.match.room = next;
}
function seatList(state) {
	return state.match.seats;
}
/**
* Whether the match is decided: its last round's summary says the match is over (the engine's
* own end, or first to 3), or the match summary is showing. From then on its result and places
* are final, whoever leaves; only the tap to the match summary is still to come.
*/
function decided(state) {
	const room = state.match.room;
	if (!room.match) return false;
	return room.status === "match_summary" || room.status === "round_summary" && !!room.lastRoundSummary?.matchOver;
}
/** The scores of both seats, from the match as it stands. */
function scoresOf(state) {
	const room = state.match.room;
	return seatList(state).map((seat) => ({
		seat,
		score: playerById(room, playerOf(seat))?.score ?? 0
	}));
}
/** Both seats' scores, best first (seat order on a tie). */
function bestFirst(state) {
	return [...scoresOf(state)].sort((x, y) => y.score - x.score);
}
/** The final result of a decided match, or null while it is still being played. */
function decidedResult(state) {
	return decided(state) ? bestFirst(state) : null;
}
/** Places for a decided match: the winner first, both first after a tie. */
function decidedStandings(state) {
	if (!decided(state)) return [];
	const sorted = bestFirst(state);
	return sorted.map((row) => ({
		seat: row.seat,
		place: 1 + sorted.filter((other) => other.score > row.score).length
	}));
}
function screenOf(state, now) {
	return {
		...game$1.snapshot(state.match, now, { role: "screen" }),
		match: state.settings.match
	};
}
function publicIdentity(id) {
	const identity = getIdentity(id);
	return {
		id: identity.id,
		canonicalName: identity.canonicalName,
		categoryId: identity.categoryId
	};
}
function audienceOf(state, now) {
	const { role: _role, ...screen } = screenOf(state, now);
	const room = state.match.room;
	const round = room.round;
	const summary = room.lastRoundSummary;
	const between = room.status === "round_summary" || room.status === "match_summary";
	return {
		...screen,
		role: "audience",
		scores: scoresOf(state),
		identities: round ? seatList(state).flatMap((seat) => {
			const id = round.assignments[playerOf(seat)];
			return id ? [{
				seat,
				identity: publicIdentity(id)
			}] : [];
		}) : [],
		reveal: between && summary ? {
			roundIndex: summary.roundIndex,
			matchOver: summary.matchOver,
			entries: seatList(state).flatMap((seat) => {
				const entry = summary.entries.find((e) => e.playerId === playerOf(seat));
				return entry ? [{
					seat,
					identity: publicIdentity(entry.identityId),
					result: entry.result
				}] : [];
			})
		} : null
	};
}
var game = {
	id: manifest.id,
	minSeats: 2,
	maxSeats: 2,
	/** Turn-based: the room never ticks it on a timer, and wakes for an input or `nextDeadline`. */
	tickHz: 0,
	/**
	* A dropped phone keeps its seat for a minute (a lost signal, a reload), and the turn timer
	* pauses meanwhile. A phone that has not come back by then forfeits: the room ends the match
	* through `abandon`, and the player who stayed wins it. Without a limit the player left behind
	* could do nothing but leave, and leaving would hand the win to the one who vanished.
	* A hidden or locked page whose socket stays open is away, not dropped: the room closes such a
	* socket only once it has said nothing (not even its keep-alive) for this long, and then counts
	* it gone at once, so a frozen page is given up on the same way at the room's next wake-up.
	*/
	reconnectGraceMs: RECONNECT_GRACE_MS,
	/** A match is people talking, with a tap now and then: two locked phones must not lose it. */
	idleShutdownMs: ROOM_IDLE_MS,
	staleRoomMs: ROOM_IDLE_MS,
	/**
	* Checks the host's choices (the party room's settings step) and returns them clean, with the
	* defaults filled in, or refuses them. Missing settings are the defaults: a match first to 3.
	*/
	settings(value) {
		const parsed = RoomSettingsSchema.safeParse(value ?? {});
		if (parsed.success) return parsed.data;
		const issue = parsed.error.issues[0];
		return {
			ok: false,
			error: "bad_settings",
			message: issue ? `${issue.path.join(".") || "settings"}: ${issue.message}` : "Those settings cannot be used."
		};
	},
	/**
	* A match begins with the party's two seats, both here (they just voted). `seed` is not read:
	* the identities come from a secure random source inside the game. `settings` and `carry` are
	* what the party room passes once it has a settings step and keeps a rematch's carry; without
	* them the match is the defaults, with a random first guesser.
	*/
	create(input) {
		if (input.seats.length !== 2) throw new Error("Who Am I? takes exactly two seats");
		const checked = game.settings(input.settings);
		if ("ok" in checked) throw new Error(checked.message);
		const { settings, pointsToWin } = engineSettings(checked);
		return {
			match: game$1.create({
				seats: input.seats.map((s) => ({
					seat: s.seat,
					name: nicknameOf(s.name)
				})),
				settings,
				now: input.now,
				carry: carryOf(input.carry),
				...input.sources ? { sources: input.sources } : {}
			}),
			settings: checked,
			pointsToWin
		};
	},
	/**
	* One command from a seat: the engine's own commands, with `commandId` and `expectedVersion`,
	* answered `{ok: true}` or `{ok: false, error, message}`. A turn whose deadline has passed ends
	* first. The lobby's, settings' and rematch commands are refused: the room owns those.
	*/
	input(state, seat, data, now, sources = cryptoSources) {
		const result = game$1.input(state.match, seat, data, now, sources);
		applyTarget(state);
		return result;
	},
	/**
	* What this viewer may see. One of the two players gets their own view, whatever role they are
	* named by: a seat in the match never gets the audience's view, which holds its own identity.
	* A member watching as the audience gets both identities; the screen, a member watching as a
	* screen, and anyone not known get the screen's view.
	*/
	snapshot(state, now, viewer) {
		const role = viewer && typeof viewer === "object" ? viewer.role : void 0;
		const seat = viewer && typeof viewer === "object" ? viewer.seat : void 0;
		if ((role === "player" || role === "audience") && typeof seat === "number" && seatList(state).includes(seat)) return {
			...game$1.snapshot(state.match, now, {
				role: "player",
				seat
			}),
			role: "player",
			seat,
			match: state.settings.match
		};
		if (role === "audience") return audienceOf(state, now);
		return screenOf(state, now);
	},
	/** The turn timer's end, or null when there is none or it is paused. */
	nextDeadline(state) {
		return game$1.nextDeadline(state.match);
	},
	/** The room's alarm at `nextDeadline`: the turn ends as timed out, and the next one starts with its own deadline. */
	tick(state, now, sources = cryptoSources) {
		const events = game$1.tick(state.match, now, sources);
		applyTarget(state);
		return events;
	},
	/** Who is here changed: a phone gone or hidden pauses the timer, and counts towards the host's override. */
	presence(state, seat, report, now, sources = cryptoSources) {
		return game$1.presence(state.match, seat, report, now, sources);
	},
	/**
	* A seat is gone for good: the match ends. A match already decided (its last round's summary is
	* up) ends as it was decided, whoever goes. Otherwise the player who stayed wins it and the one
	* who went gets no place, except:
	* - A player who leaves the party (their page here when they go) while the one who stayed has
	*   been gone (dropped, or their page hidden) 30 seconds or more: nobody wins, so leaving a
	*   match whose other phone vanished does not hand the vanished player the win.
	* - A player who forfeits (their phone dropped or hidden when the room gives up on it) while the
	*   one who stayed has been dropped 30 seconds or more too: nobody wins. A stayer whose page is
	*   merely hidden, its socket still open, wins the forfeit.
	*/
	abandon(state, seat, now) {
		const seats = seatList(state);
		const stayed = seats.find((s) => s !== seat);
		if (!seats.includes(seat) || stayed === void 0) return {
			standings: [],
			result: null,
			events: []
		};
		if (decided(state)) return {
			standings: decidedStandings(state),
			result: decidedResult(state),
			events: []
		};
		const room = state.match.room;
		const went = playerById(room, playerOf(seat));
		const other = playerById(room, playerOf(stayed));
		const forfeit = !!went && absentSince(went) !== null;
		const since = !other ? null : forfeit ? other.connected ? null : other.disconnectedAt : absentSince(other);
		const otherGone = since !== null && now - since >= ABSENT_MS;
		const rows = bestFirst(state);
		return {
			standings: otherGone ? [] : [{
				seat: stayed,
				place: 1
			}],
			result: otherGone ? rows : [...rows.filter((r) => r.seat === stayed), ...rows.filter((r) => r.seat !== stayed)],
			events: [{
				k: "abandoned",
				seat
			}]
		};
	},
	isOver(state) {
		return game$1.isOver(state.match);
	},
	/** Sent to everyone with the end: each seat's score, best first. No identity. */
	result(state) {
		return decidedResult(state);
	},
	/** Places for the night: the winner first, both first after a tie. */
	standings(state) {
		return decidedStandings(state);
	},
	/**
	* What a rematch between the same two seats starts from: the identities this match used, so the
	* next draw avoids them, and who lost, so they guess first. Server-only: the room keeps it for
	* `create` and never sends it. Kept under the room's 4 KB by dropping the oldest identities.
	*/
	carry(state) {
		const carry = game$1.carry(state.match);
		if (!carry) return null;
		const used = [...carry.usedIdentityIds];
		while (used.length && JSON.stringify({
			...carry,
			usedIdentityIds: used
		}).length > 3500) used.shift();
		return {
			...carry,
			usedIdentityIds: used
		};
	},
	/** The whole state, for the room's save after every input. `input` sees `restore(serialize(state))`. */
	serialize(state) {
		return JSON.stringify({
			shape: "who-am-i/party-room/1",
			state
		});
	},
	restore(text) {
		const saved = JSON.parse(text);
		if (saved?.shape !== "who-am-i/party-room/1" || !saved.state) throw new Error("Not a saved Who Am I? party game");
		const { match, settings, pointsToWin } = saved.state;
		const restoredMatch = game$1.restore(JSON.stringify(match ?? null));
		const checked = RoomSettingsSchema.safeParse(settings);
		if (!checked.success) throw new Error("Not a saved Who Am I? party game");
		if (!(pointsToWin === null || typeof pointsToWin === "number" && Number.isInteger(pointsToWin) && pointsToWin > 0)) throw new Error("Not a saved Who Am I? party game");
		return {
			match: restoredMatch,
			settings: checked.data,
			pointsToWin
		};
	}
};
export { game, manifest };
