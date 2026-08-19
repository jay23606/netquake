import * as draw from './draw'
import * as cl from './cl'
import * as cmd from './cmd'
import * as com from './com'
import * as vid from './vid'
import * as def from './def'
import * as scr from './scr'
import * as host from './host'
import * as con from './console'
import * as wwheel from './wwheel'
import { Pic } from './texture'

// A weapon a mod declared in wwheel.txt on an item bit the classic row doesn't cover.
type ExtraWeapon = {
	// .items bit (wwheel `weaponnum`); also its STAT_ACTIVEWEAPON value.
	bit: number,
	// [unselected, selected]
	pics: Pic[]
}

type SbarState = {
	scale: number
	showscores: boolean,
	fragsort: number[],
	nums: [Pic[], Pic[]],
	colon: Pic,
	slash: Pic,
	weapons: Pic[][],
	ammo: Pic[],
	armor: Pic[],
	items: Pic[],
	sigil: Pic[],
	faces: Pic[][],
	face_invis: Pic,
	face_invuln: Pic,
	face_invis_invuln: Pic,
	face_quad: Pic,
	sbar: Pic,
	ibar: Pic,
	scorebar: Pic,
	ranking: Pic,
	complete: Pic,
	inter: Pic,
	finale: Pic,
	disc: Pic,
	h_weapons: Pic[][],
	hipweapons: number[],
	h_items: Pic[],
	r_invbar: Pic[],
	r_weapons: Pic[],
	r_items: Pic[],
	r_teambord: Pic,
	r_ammo: Pic[],
	extraWeapons: ExtraWeapon[],
	scoreboardlines: number,
	lines: number
}

export const state: SbarState = {
	scale: 2,
	showscores: false,
	fragsort: [],
	nums: [[], []],
	weapons: [],
	colon: null,
	slash: null,
	ammo: [],
	armor: [],
	items: [],
	sigil: [],
	faces: [],
	face_invis: null,
	face_invuln: null,
	face_invis_invuln: null,
	face_quad: null,
	sbar: null,
	ibar: null,
	scorebar: null,
	ranking: null,
	complete: null,
	inter: null,
	finale: null,
	disc: null,
	h_weapons: [],
	hipweapons: [],
	h_items: [],
	r_invbar: [],
	r_weapons: [],
	r_items: [],
	r_teambord: null,
	r_ammo: [],
	extraWeapons: [],
	scoreboardlines: 0,
	lines: 0
};

export const showScores = function()
{
	state.showscores = true;
	cl.requestPingUpdate();
};

export const dontShowScores = function()
{
	state.showscores = false;
};

export const init = async function()
{
	var i;

	state.nums = [[], []];
	for (i = 0; i < 10; ++i)
	{
		state.nums[0][i] = draw.picFromWad('NUM_' + i);
		state.nums[1][i] = draw.picFromWad('ANUM_' + i);
	}
	state.nums[0][10] = draw.picFromWad('NUM_MINUS');
	state.nums[1][10] = draw.picFromWad('ANUM_MINUS');
	state.colon = draw.picFromWad('NUM_COLON');
	state.slash = draw.picFromWad('NUM_SLASH');

	state.weapons = [
		[
			draw.picFromWad('INV_SHOTGUN'),
			draw.picFromWad('INV_SSHOTGUN'),
			draw.picFromWad('INV_NAILGUN'),
			draw.picFromWad('INV_SNAILGUN'),
			draw.picFromWad('INV_RLAUNCH'),
			draw.picFromWad('INV_SRLAUNCH'),
			draw.picFromWad('INV_LIGHTNG')
		],
		[
			draw.picFromWad('INV2_SHOTGUN'),
			draw.picFromWad('INV2_SSHOTGUN'),
			draw.picFromWad('INV2_NAILGUN'),
			draw.picFromWad('INV2_SNAILGUN'),
			draw.picFromWad('INV2_RLAUNCH'),
			draw.picFromWad('INV2_SRLAUNCH'),
			draw.picFromWad('INV2_LIGHTNG')
		]
	];
	for (i = 0; i <= 4; ++i)
	{
		state.weapons[2 + i] = [
			draw.picFromWad('INVA' + (i + 1) + '_SHOTGUN'),
			draw.picFromWad('INVA' + (i + 1) + '_SSHOTGUN'),
			draw.picFromWad('INVA' + (i + 1) + '_NAILGUN'),
			draw.picFromWad('INVA' + (i + 1) + '_SNAILGUN'),
			draw.picFromWad('INVA' + (i + 1) + '_RLAUNCH'),
			draw.picFromWad('INVA' + (i + 1) + '_SRLAUNCH'),
			draw.picFromWad('INVA' + (i + 1) + '_LIGHTNG')
		];
	}

	state.ammo = [
		draw.picFromWad('SB_SHELLS'),
		draw.picFromWad('SB_NAILS'),
		draw.picFromWad('SB_ROCKET'),
		draw.picFromWad('SB_CELLS')
	];

	state.armor = [
		draw.picFromWad('SB_ARMOR1'),
		draw.picFromWad('SB_ARMOR2'),
		draw.picFromWad('SB_ARMOR3')
	];

	state.items = [
		draw.picFromWad('SB_KEY1'),
		draw.picFromWad('SB_KEY2'),
		draw.picFromWad('SB_INVIS'),
		draw.picFromWad('SB_INVULN'),
		draw.picFromWad('SB_SUIT'),
		draw.picFromWad('SB_QUAD')
	];

	state.sigil = [
		draw.picFromWad('SB_SIGIL1'),
		draw.picFromWad('SB_SIGIL2'),
		draw.picFromWad('SB_SIGIL3'),
		draw.picFromWad('SB_SIGIL4')
	];

	state.faces = [];
	for (i = 0; i <= 4; ++i)
	{
		state.faces[i] = [
			draw.picFromWad('FACE' + (5 - i)),
			draw.picFromWad('FACE_P' + (5 - i))
		];
	}
	state.face_invis = draw.picFromWad('FACE_INVIS');
	state.face_invuln = draw.picFromWad('FACE_INVUL2');
	state.face_invis_invuln = draw.picFromWad('FACE_INV2');
	state.face_quad = draw.picFromWad('FACE_QUAD');

	cmd.addCommand('+showscores', showScores);
	cmd.addCommand('-showscores', dontShowScores);

	state.sbar = draw.picFromWad('SBAR');
	state.ibar = draw.picFromWad('IBAR');
	state.scorebar = draw.picFromWad('SCOREBAR');

	state.ranking = await draw.cachePic('ranking');
	state.complete = await draw.cachePic('complete');
	state.inter = await draw.cachePic('inter');
	state.finale = await draw.cachePic('finale');

	state.disc = draw.picFromWad('DISC');

	if (com.state.hipnotic === true)
	{
		state.h_weapons = [[
			draw.picFromWad('INV_LASER'),
			draw.picFromWad('INV_MJOLNIR'),
			draw.picFromWad('INV_GREN_PROX'),
			draw.picFromWad('INV_PROX_GREN'),
			draw.picFromWad('INV_PROX')
		],
		[
			draw.picFromWad('INV2_LASER'),
			draw.picFromWad('INV2_MJOLNIR'),
			draw.picFromWad('INV2_GREN_PROX'),
			draw.picFromWad('INV2_PROX_GREN'),
			draw.picFromWad('INV2_PROX')
		]];
		for (i = 0; i <= 4; ++i)
		{
			state.h_weapons[2 + i] = [
				draw.picFromWad('INVA' + (i + 1) + '_LASER'),
				draw.picFromWad('INVA' + (i + 1) + '_MJOLNIR'),
				draw.picFromWad('INVA' + (i + 1) + '_GREN_PROX'),
				draw.picFromWad('INVA' + (i + 1) + '_PROX_GREN'),
				draw.picFromWad('INVA' + (i + 1) + '_PROX')
			];
		}
		state.hipweapons = [def.HIT.laser_cannon_bit, def.HIT.mjolnir_bit, 4, def.HIT.proximity_gun_bit];
		state.h_items = [
			draw.picFromWad('SB_WSUIT'),
			draw.picFromWad('SB_ESHLD')
		];
	}
	else if (com.state.rogue === true)
	{
		state.r_invbar = [
			draw.picFromWad('R_INVBAR1'),
			draw.picFromWad('R_INVBAR2')
		];
		state.r_weapons = [
			draw.picFromWad('R_LAVA'),
			draw.picFromWad('R_SUPERLAVA'),
			draw.picFromWad('R_GREN'),
			draw.picFromWad('R_MULTIROCK'),
			draw.picFromWad('R_PLASMA')
		];
		state.r_items = [
			draw.picFromWad('R_SHIELD1'),
			draw.picFromWad('R_AGRAV1')
		];
		state.r_teambord = draw.picFromWad('R_TEAMBORD');
		state.r_ammo = [
			draw.picFromWad('R_AMMOLAVA'),
			draw.picFromWad('R_AMMOMULTI'),
			draw.picFromWad('R_AMMOPLASMA')
		];
	}

	await loadExtraWeapons();
};

// Item bits the classic weapon row accounts for: the seven drawn weapons, plus the cell-less axe.
const CLASSIC_WEAPON_BITS = def.IT.shotgun | def.IT.super_shotgun | def.IT.nailgun | def.IT.super_nailgun
	| def.IT.grenade_launcher | def.IT.rocket_launcher | def.IT.lightning | def.IT.axe;

// Give a weapon-row cell to each weapon a mod declares in wwheel.txt on a non-classic .items bit
// (the rerelease episodes do this). A mod with no wwheel.txt leaves the list empty.
// Skipped under -hipnotic/-rogue: those mission packs have hardwired extra rows owning the same
// strip of the ibar, and hipnotic's laser cannon is the very bit (23) mg3's laser reuses.
const loadExtraWeapons = async function()
{
	state.extraWeapons = [];
	if ((com.state.hipnotic === true) || (com.state.rogue === true))
		return;
	await wwheel.load();
	for (var i = 0; i < wwheel.state.slots.length; ++i)
	{
		const slot = wwheel.state.slots[i];
		if ((slot.weaponBit === 0) || ((slot.weaponBit & CLASSIC_WEAPON_BITS) !== 0))
			continue;
		const pic = await draw.cachePicPath(slot.icon);
		if (pic == null)
		{
			con.dPrint('Sbar: no icon for wwheel weapon ' + slot.weaponBit + '\n');
			continue;
		}
		const sel = await draw.cachePicPath(slot.iconSel);
		state.extraWeapons[state.extraWeapons.length] = { bit: slot.weaponBit, pics: [pic, sel != null ? sel : pic] };
	}
};

// x/y are 320x200 status-bar units. `scale` sizes the pic itself; the default of one pic pixel
// per bar unit is all vanilla art wants.
export const drawPic = function(x: number, y: number, pic: Pic, scale = state.scale)
{
	if (cl.clState.gametype === 1)
		draw.pic(x * state.scale, y * state.scale + vid.state.height - (24 * state.scale), pic, scale);
	else
		draw.pic(x * state.scale + (vid.state.width >> 1) - (320 * state.scale >> 1), y * state.scale + vid.state.height - (24 * state.scale), pic, scale);
};

// Fit a mod-supplied icon into the 24x16 cell — they are authored at any resolution (the
// rerelease's are 48x32) and would otherwise spill over their neighbours.
const drawWeaponIcon = function(x: number, y: number, pic: Pic)
{
	const fit = Math.min(24 / pic.width, 16 / pic.height, 1);
	drawPic(x + (24 - pic.width * fit) * 0.5, y + (16 - pic.height * fit) * 0.5, pic, state.scale * fit);
};

export const drawCharacter = function(x: number, y: number, num: number)
{
	if (cl.clState.gametype === 1)
		draw.character(x * state.scale + 4, y * state.scale + vid.state.height - (24 * state.scale), num, state.scale * 8);
	else
		draw.character((x + 4) * state.scale + (vid.state.width >> 1) - (320 * state.scale >> 1), y * state.scale + vid.state.height - (24 * state.scale), num, state.scale * 8);
};

export const drawString = function(x: number, y: number, str: string)
{
	if (cl.clState.gametype === 1)
		draw.string(x * state.scale, y * state.scale + vid.state.height - (24 * state.scale), str, state.scale * 8);
	else
		draw.string(x * state.scale + (vid.state.width >> 1) - (320 * state.scale >> 1), y * state.scale + vid.state.height - (24 * state.scale), str, state.scale * 8);;
};

export const drawNum = function(x: number, y: number, num: number, digits: number, color: number)
{
	var str = num.toString();
	if (str.length > digits)
		str = str.substring(str.length - digits, str.length);
	else if (str.length < digits)
		x += (digits - str.length) * 24;
	var i, frame;
	for (i = 0; i < str.length; ++i)
	{
		frame = str.charCodeAt(i);
		drawPic(x, y, state.nums[color][frame === 45 ? 10 : frame - 48]);
		x += 24;
	}
};

export const sortFrags = function()
{
	state.scoreboardlines = 0;
	var i, j, k;
	for (i = 0; i < cl.clState.maxclients; ++i)
	{
		if (cl.clState.scores[i].name.length !== 0)
			state.fragsort[state.scoreboardlines++] = i;
	}
	for (i = 0; i < state.scoreboardlines; ++i)
	{
		for (j = 0; j < (state.scoreboardlines - 1 - i); ++j)
		{
			if (cl.clState.scores[state.fragsort[j]].frags < cl.clState.scores[state.fragsort[j + 1]].frags)
			{
				k = state.fragsort[j];
				state.fragsort[j] = state.fragsort[j + 1];
				state.fragsort[j + 1] = k;
			}
		}
	}
};

export const soloScoreboard = function()
{
	var str;

	drawString(8, 4, 'Monsters:    /');
	str = cl.clState.stats[def.STAT.monsters].toString();
	drawString(104 - (str.length << 3), 4, str);
	str = cl.clState.stats[def.STAT.totalmonsters].toString();
	drawString(144 - (str.length << 3), 4, str);

	drawString(8, 12, 'Secrets :    /');
	str = cl.clState.stats[def.STAT.secrets].toString();
	drawString(104 - (str.length << 3), 12, str);
	str = cl.clState.stats[def.STAT.totalsecrets].toString();
	drawString(144 - (str.length << 3), 12, str);

	var minutes = Math.floor(cl.clState.time / 60.0);
	var seconds = Math.floor(cl.clState.time - 60 * minutes);
	var tens = Math.floor(seconds / 10.0);
	str = (seconds - 10 * tens).toString();
	drawString(184, 4, 'Time :   :' + tens + str);
	str = minutes.toString();
	drawString(256 - (str.length << 3), 4, str);

	drawString(232 - (cl.clState.levelname.length << 2), 12, cl.clState.levelname);
};

export const drawInventory = function()
{
	var i;

	if (com.state.rogue === true)
		drawPic(0, -24, state.r_invbar[cl.clState.stats[def.STAT.activeweapon] >= def.RIT.lava_nailgun ? 0 : 1]);
	else
		drawPic(0, -24, state.ibar);

	var flashon;
	for (i = 0; i <= 6; ++i)
	{
		if ((cl.clState.items & (def.IT.shotgun << i)) === 0)
			continue;
		flashon = Math.floor((cl.clState.time - cl.clState.item_gettime[i]) * 10.0);
		if (flashon >= 10)
			flashon = cl.clState.stats[def.STAT.activeweapon] === (def.IT.shotgun << i) ? 1 : 0;
		else
			flashon = (flashon % 5) + 2;
		drawPic(i * 24, -16, state.weapons[flashon][i]);
	}
	if (com.state.hipnotic === true)
	{
		var grenadeflashing = false;
		for (i = 0; i <= 3; ++i)
		{
			if ((cl.clState.items & (1 << state.hipweapons[i])) !== 0)
			{
				flashon = Math.floor((cl.clState.time - cl.clState.item_gettime[i]) * 10.0);
				if (flashon >= 10)
					flashon = cl.clState.stats[def.STAT.activeweapon] === (1 << state.hipweapons[i]) ? 1 : 0;
				else
					flashon = (flashon % 5) + 2;

				if (i === 2)
				{
					if (((cl.clState.items & def.HIT.proximity_gun) !== 0) && (flashon !== 0))
					{
						grenadeflashing = true;
						drawPic(96, -16, state.h_weapons[flashon][2]);
					}
				}
				else if (i === 3)
				{
					if ((cl.clState.items & def.IT.grenade_launcher) !== 0)
					{
						if (grenadeflashing !== true)
							drawPic(96, -16, state.h_weapons[flashon][3]);
					}
					else
						drawPic(96, -16, state.h_weapons[flashon][4]);
				}
				else
					drawPic(176 + i * 24, -16, state.h_weapons[flashon][i]);
			}
		}
	}
	else if (com.state.rogue === true)
	{
		if (cl.clState.stats[def.STAT.activeweapon] >= def.RIT.lava_nailgun)
		{
			for (i = 0; i <= 4; ++i)
			{
				if (cl.clState.stats[def.STAT.activeweapon] === (def.RIT.lava_nailgun << i))
					drawPic((i + 2) * 24, -16, state.r_weapons[i]);
			}
		}
	}

	// wwheel weapons continue the row into the blank strip between the seventh cell (x=168) and
	// the item icons (x=192). Only two icons exist per weapon, so they show selected/unselected
	// rather than the classic five-frame pickup flash.
	for (i = 0; i < state.extraWeapons.length; ++i)
	{
		const xw = state.extraWeapons[i];
		if ((cl.clState.items & xw.bit) === 0)
			continue;
		drawWeaponIcon(168 + i * 24, -16, xw.pics[cl.clState.stats[def.STAT.activeweapon] === xw.bit ? 1 : 0]);
	}

	for (i = 0; i <= 3; ++i)
	{
		var num = cl.clState.stats[def.STAT.shells + i].toString();
		switch (num.length)
		{
		case 1:
			drawCharacter(((6 * i + 3) << 3) - 2, -24, num.charCodeAt(0) - 30);
			continue;
		case 2:
			drawCharacter(((6 * i + 2) << 3) - 2, -24, num.charCodeAt(0) - 30);
			drawCharacter(((6 * i + 3) << 3) - 2, -24, num.charCodeAt(1) - 30);
			continue;
		case 3:
			drawCharacter(((6 * i + 1) << 3) - 2, -24, num.charCodeAt(0) - 30);
			drawCharacter(((6 * i + 2) << 3) - 2, -24, num.charCodeAt(1) - 30);
			drawCharacter(((6 * i + 3) << 3) - 2, -24, num.charCodeAt(2) - 30);
		}
	}

	if (com.state.hipnotic === true)
	{
		for (i = 2; i <= 5; ++i)
		{
			if ((cl.clState.items & (1 << (17 + i))) !== 0)
				drawPic(192 + (i << 4), -16, state.items[i]);
		}
		if ((cl.clState.items & 16777216) !== 0)
			drawPic(288, -16, state.h_items[0]);
		if ((cl.clState.items & 33554432) !== 0)
			drawPic(304, -16, state.h_items[1]);
	}
	else
	{
		for (i = 0; i <= 5; ++i)
		{
			if ((cl.clState.items & (1 << (17 + i))) !== 0)
				drawPic(192 + (i << 4), -16, state.items[i]);
		}
		if (com.state.rogue === true)
		{
			if ((cl.clState.items & 536870912) !== 0)
				drawPic(288, -16, state.r_items[0]);
			if ((cl.clState.items & 1073741824) !== 0)
				drawPic(304, -16, state.r_items[1]);
		}
		else
		{
			for (i = 0; i <= 3; ++i)
			{
				if (((cl.clState.items >>> (28 + i)) & 1) !== 0)
					drawPic(288 + (i << 3), -16, state.sigil[i]);
			}
		}
	}
};

export const drawFrags = function()
{
	sortFrags();
	var l = state.scoreboardlines <= 4 ? state.scoreboardlines : 4;
	var x = 23;
	var xofs = cl.clState.gametype === 1 ? 10 * state.scale : (vid.state.width >> 1) - (300 * state.scale >> 1);
	var y = vid.state.height - (47 * state.scale);
	var i, k, s, num
	for (i = 0; i < l; ++i)
	{
		k = state.fragsort[i];
		s = cl.clState.scores[k];
		if (s.name.length === 0)
			continue;
		draw.fill((xofs + ((x * state.scale) << 3)), y, 28 * state.scale, 4 * state.scale, (s.colors & 0xf0) + 8);
		draw.fill((xofs + ((x * state.scale) << 3)), y + 4 * state.scale, 28 * state.scale, 3 * state.scale, ((s.colors & 0xf) << 4) + 8);
		num = s.frags.toString();
		drawString(((x  - num.length) << 3) + 36, -24, num);
		if (k === (cl.clState.viewentity - 1))
		{
			drawCharacter((x << 3) + 4, -24, 16);
			drawCharacter((x << 3) + 30, -24, 17);
		}
		x += 4
	}
};

export const drawFace = function()
{
	if ((com.state.rogue === true) && (cl.clState.maxclients !== 1) && (host.cvr.teamplay.value >= 4) && (host.cvr.teamplay.value <= 6))
	{
		var s = cl.clState.scores[cl.clState.viewentity - 1];
		var top = (s.colors & 0xf0) + 8;
		var xofs = cl.clState.gametype === 1 ? 113 : (vid.state.width >> 1) - 47;
		drawPic(112, 0, state.r_teambord);
		draw.fill(xofs, vid.state.height - 21, 22, 9, top);
		draw.fill(xofs, vid.state.height - 12, 22, 9, ((s.colors & 0xf) << 4) + 8);
		var num = (top === 8 ? '\x3E\x3E\x3E' : '   ') + s.frags;
		if (num.length > 3)
			num = num.substring(num.length - 3);
		if (top === 8)
		{
			drawCharacter(109, 3, num.charCodeAt(0) - 30);
			drawCharacter(116, 3, num.charCodeAt(1) - 30);
			drawCharacter(123, 3, num.charCodeAt(2) - 30);
		}
		else
		{
			drawCharacter(109, 3, num.charCodeAt(0));
			drawCharacter(116, 3, num.charCodeAt(1));
			drawCharacter(123, 3, num.charCodeAt(2));
		}
		return;
	}

	if ((cl.clState.items & (def.IT.invisibility + def.IT.invulnerability)) === (def.IT.invisibility + def.IT.invulnerability))
	{
		drawPic(112, 0, state.face_invis_invuln);
		return;
	}
	if ((cl.clState.items & def.IT.quad) !== 0)
	{
		drawPic(112, 0, state.face_quad);
		return;
	}
	if ((cl.clState.items & def.IT.invisibility) !== 0)
	{
		drawPic(112, 0, state.face_invis);
		return;
	}
	if ((cl.clState.items & def.IT.invulnerability) !== 0)
	{
		drawPic(112, 0, state.face_invuln);
		return;
	}
	drawPic(112, 0, state.faces[cl.clState.stats[def.STAT.health] >= 100.0 ? 4 : Math.floor(cl.clState.stats[def.STAT.health] / 20.0)][cl.clState.time <= cl.clState.faceanimtime ? 1 : 0]);
};

export const drawSbar = function()
{
	if (scr.state.con_current >= 200)
		return;

	if (state.lines > (24 * state.scale))
	{
		drawInventory();
		if (cl.clState.maxclients !== 1)
			drawFrags();
	}

	if ((state.showscores === true) || (cl.clState.stats[def.STAT.health] <= 0))
	{
		drawPic(0, 0, state.scorebar);
		soloScoreboard();
		if (cl.clState.gametype === 1)
			deathmatchOverlay();
		return;
	}

	if (state.lines === 0)
		return;

	drawPic(0, 0, state.sbar);

	if (com.state.hipnotic === true)
	{
		if ((cl.clState.items & def.IT.key1) !== 0)
			drawPic(209, 3, state.items[0]);
		if ((cl.clState.items & def.IT.key2) !== 0)
			drawPic(209, 12, state.items[1]);
	}

	var it = (com.state.rogue === true) ? def.RIT : def.IT;

	if ((cl.clState.items & def.IT.invulnerability) !== 0)
	{
		drawNum(24, 0, 666, 3, 1);
		drawPic(0, 0, state.disc);
	}
	else
	{
		drawNum(24, 0, cl.clState.stats[def.STAT.armor], 3, cl.clState.stats[def.STAT.armor] <= 25 ? 1 : 0);
		if ((cl.clState.items & it.armor3) !== 0)
			drawPic(0, 0, state.armor[2]);
		else if ((cl.clState.items & it.armor2) !== 0)
			drawPic(0, 0, state.armor[1]);
		else if ((cl.clState.items & it.armor1) !== 0)
			drawPic(0, 0, state.armor[0]);
	}

	drawFace();

	drawNum(136, 0, cl.clState.stats[def.STAT.health], 3, cl.clState.stats[def.STAT.health] <= 25 ? 1 : 0);

	if ((cl.clState.items & it.shells) !== 0)
		drawPic(224, 0, state.ammo[0]);
	else if ((cl.clState.items & it.nails) !== 0)
		drawPic(224, 0, state.ammo[1]);
	else if ((cl.clState.items & it.rockets) !== 0)
		drawPic(224, 0, state.ammo[2]);
	else if ((cl.clState.items & it.cells) !== 0)
		drawPic(224, 0, state.ammo[3]);
	else if (com.state.rogue === true)
	{
		if ((cl.clState.items & def.RIT.lava_nails) !== 0)
			drawPic(224, 0, state.r_ammo[0]);
		else if ((cl.clState.items & def.RIT.plasma_ammo) !== 0)
			drawPic(224, 0, state.r_ammo[1]);
		else if ((cl.clState.items & def.RIT.multi_rockets) !== 0)
			drawPic(224, 0, state.r_ammo[2]);
	}
	drawNum(248, 0, cl.clState.stats[def.STAT.ammo], 3, cl.clState.stats[def.STAT.ammo] <= 10 ? 1 : 0);

	if ((vid.state.width >= 512) && (cl.clState.gametype === 1))
		miniDeathmatchOverlay();
};

export const intermissionNumber = function(x: number, y: number, num: number)
{
	var str = num.toString();
	if (str.length > 3)
		str = str.substring(str.length - 3, str.length);
	else if (str.length < 3)
		x += (3 - str.length) * 24;
	var i, frame;
	for (i = 0; i < str.length; ++i)
	{
		frame = str.charCodeAt(i);
		draw.pic(x * state.scale, y * state.scale, state.nums[0][frame === 45 ? 10 : frame - 48], state.scale);
		x += 24;
	}
};

export const deathmatchOverlay = function()
{
	draw.pic((vid.state.width - (state.ranking.width * state.scale)) >> 1, 8 * state.scale, state.ranking, state.scale);
	sortFrags();

	var x = ((vid.state.width >> 1) - (80 * state.scale)), y = (40 * state.scale);
	var i, s, f;
	for (i = 0; i < state.scoreboardlines; ++i)
	{
		s = cl.clState.scores[state.fragsort[i]];
		if (s.name.length === 0)
			continue;
		// ping / bot label — wait for first ping cycle before showing anything definitive
		var pingStr = !s.pinged ? '    ' : (s.isBot && s.name !== 'unconnected') ? ' bot' : s.ping.toString().padStart(4, ' ');
		draw.string(x - (40 * state.scale), y, pingStr);
		draw.fill(x, y, (40 * state.scale), 4 * state.scale, (s.colors & 0xf0) + 8);
		draw.fill(x, y + (4 * state.scale), 40 * state.scale, 4 * state.scale, ((s.colors & 0xf) << 4) + 8);
		f = s.frags.toString();
		draw.string((x + (32 - (f.length << 3)) * state.scale), y, f);
		if (state.fragsort[i] === (cl.clState.viewentity - 1))
			draw.character((x - 8 * state.scale), y, 12);
		draw.string((x + (64 * state.scale)), y, s.name);
		y += (10 * state.scale);
	}
};

export const miniDeathmatchOverlay = function()
{
	sortFrags();
	var l = state.scoreboardlines;
	var y = vid.state.height - state.lines;
	var numlines = state.lines >> 3;
	var i;

	for (i = 0; i < l; ++i)
	{
		if (state.fragsort[i] === (cl.clState.viewentity - 1))
			break;
	}

	i = (i === l) ? 0 : i - (numlines >> 1);
	if (i > (l - numlines))
		i = l - numlines;
	if (i < 0)
		i = 0;

	var k, s, num;
	for (; (i < l) && (y < (vid.state.height - 8)); ++i)
	{
		k = state.fragsort[i];
		s = cl.clState.scores[k];
		if (s.name.length === 0)
			continue;
		draw.fill(324 * state.scale, y + 1 * state.scale, 40 * state.scale, 3 * state.scale, (s.colors & 0xf0) + 8);
		draw.fill(324 * state.scale, y + 4 * state.scale, 40 * state.scale, 4 * state.scale, ((s.colors & 0xf) << 4) + 8);
		num = s.frags.toString();
		draw.string((356 * state.scale) - (num.length * (8*state.scale)), y, num);
		if (k === (cl.clState.viewentity - 1))
		{
			draw.character(324 * state.scale, y, 16, (8 * state.scale));
			draw.character(356 * state.scale, y, 17, (8 * state.scale));
		}
		draw.string(372 * state.scale, y, s.name);
		y += (8 * state.scale);
	}
};

// QSS-M Sbar_IntermissionPicForChar: digits/slash/colon/minus map to sbar pics; anything
// else (spaces from the %2d padding) is null.
const intermissionPicForChar = function(c: string)
{
	if (c >= '0' && c <= '9')
		return state.nums[0][c.charCodeAt(0) - 48];
	if (c === '/')
		return state.slash;
	if (c === ':')
		return state.colon;
	if (c === '-')
		return state.nums[0][10];
	return null;
};

// QSS-M Sbar_IntermissionTextWidth: sum of glyph widths; null chars (spaces) count 24.
const intermissionTextWidth = function(str: string)
{
	var len = 0;
	for (var i = 0; i < str.length; ++i)
	{
		const pic = intermissionPicForChar(str[i]);
		len += pic != null ? pic.width : 24;
	}
	return len;
};

// QSS-M Sbar_IntermissionText — VERBATIM including the quirk that a null char (space)
// `continue`s without advancing x, even though TextWidth counted it as 24.
const intermissionText = function(x: number, y: number, str: string)
{
	for (var i = 0; i < str.length; ++i)
	{
		const pic = intermissionPicForChar(str[i]);
		if (pic == null)
			continue;
		draw.pic(x * state.scale, y * state.scale, pic, state.scale);
		x += pic.width;
	}
};

// QSS-M Sbar_IntermissionOverlay: measured lines right-aligned to a common edge, the
// whole block (inter plaque + widest line) centered on the 320-wide canvas.
export const intermissionOverlay = function()
{
	if (cl.clState.gametype === 1)
	{
		deathmatchOverlay();
		return;
	}

	const t = Math.floor(cl.clState.completed_time);
	const time = Math.floor(t / 60) + ':' + ('' + (t % 60)).padStart(2, '0');
	const secrets = cl.clState.stats[def.STAT.secrets] + '/' + ('' + cl.clState.stats[def.STAT.totalsecrets]).padStart(2, ' ');
	const monsters = cl.clState.stats[def.STAT.monsters] + '/' + ('' + cl.clState.stats[def.STAT.totalmonsters]).padStart(2, ' ');

	const ltime = intermissionTextWidth(time);
	const lsecrets = intermissionTextWidth(secrets);
	const lmonsters = intermissionTextWidth(monsters);

	var total = Math.max(ltime, lsecrets, lmonsters);
	total += state.inter.width + 24;
	total = Math.min(320, total);
	const half = Math.floor(total / 2);

	draw.pic((160 - half) * state.scale, 56 * state.scale, state.inter, state.scale);
	draw.pic((160 - Math.floor(state.complete.width / 2)) * state.scale, 24 * state.scale, state.complete, state.scale);

	intermissionText(160 + half - ltime, 64, time);
	intermissionText(160 + half - lsecrets, 104, secrets);
	intermissionText(160 + half - lmonsters, 144, monsters);
};

export const finaleOverlay = function()
{
	draw.pic((vid.state.width - state.finale.width) >> 1, 16, state.finale);
};