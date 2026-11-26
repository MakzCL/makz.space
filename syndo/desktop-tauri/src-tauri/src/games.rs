//! "Playing …" for the profile: every 20 seconds, look at the running programs (names only) and
//! match them against a list of well-known games. Nothing is sent anywhere except the game's
//! name to the SEND page, and only when the user allows sharing their activity.

pub const GAMES: &[(&str, &str)] = &[
  ("cs2.exe", "Counter-Strike 2"), ("csgo.exe", "Counter-Strike: Global Offensive"), ("valorant-win64-shipping.exe", "VALORANT"),
  ("leagueoflegends.exe", "League of Legends"), ("league of legends.exe", "League of Legends"), ("dota2.exe", "Dota 2"),
  ("fortniteclient-win64-shipping.exe", "Fortnite"), ("r5apex.exe", "Apex Legends"), ("r5apex_dx12.exe", "Apex Legends"),
  ("overwatch.exe", "Overwatch 2"), ("rocketleague.exe", "Rocket League"), ("minecraft.windows.exe", "Minecraft"),
  ("javaw.exe#minecraft", "Minecraft"), ("robloxplayerbeta.exe", "Roblox"), ("gta5.exe", "Grand Theft Auto V"), ("gta5_enhanced.exe", "Grand Theft Auto V"),
  ("rdr2.exe", "Red Dead Redemption 2"), ("eldenring.exe", "ELDEN RING"), ("cyberpunk2077.exe", "Cyberpunk 2077"),
  ("witcher3.exe", "The Witcher 3: Wild Hunt"), ("bg3.exe", "Baldur's Gate 3"), ("bg3_dx11.exe", "Baldur's Gate 3"),
  ("starfield.exe", "Starfield"), ("skyrimse.exe", "The Elder Scrolls V: Skyrim"), ("fallout4.exe", "Fallout 4"),
  ("destiny2.exe", "Destiny 2"), ("cod.exe", "Call of Duty"), ("modernwarfare.exe", "Call of Duty: Modern Warfare"),
  ("blackops6.exe", "Call of Duty: Black Ops 6"), ("bf2042.exe", "Battlefield 2042"), ("rainbowsix.exe", "Rainbow Six Siege"),
  ("rainbowsix_vulkan.exe", "Rainbow Six Siege"), ("tslgame.exe", "PUBG: BATTLEGROUNDS"), ("escapefromtarkov.exe", "Escape from Tarkov"),
  ("rust.exe", "Rust"), ("terraria.exe", "Terraria"), ("stardew valley.exe", "Stardew Valley"), ("among us.exe", "Among Us"),
  ("phasmophobia.exe", "Phasmophobia"), ("lethal company.exe", "Lethal Company"), ("valheim.exe", "Valheim"),
  ("palworld-win64-shipping.exe", "Palworld"), ("helldivers2.exe", "HELLDIVERS 2"), ("deadbydaylight-win64-shipping.exe", "Dead by Daylight"),
  ("warframe.x64.exe", "Warframe"), ("pathofexile.exe", "Path of Exile"), ("pathofexile_x64steam.exe", "Path of Exile"), ("pathofexile2.exe", "Path of Exile 2"),
  ("diablo iv.exe", "Diablo IV"), ("wow.exe", "World of Warcraft"), ("hearthstone.exe", "Hearthstone"), ("ffxiv_dx11.exe", "FINAL FANTASY XIV"),
  ("genshinimpact.exe", "Genshin Impact"), ("starrail.exe", "Honkai: Star Rail"), ("zenlesszonezero.exe", "Zenless Zone Zero"),
  ("osu!.exe", "osu!"), ("factorio.exe", "Factorio"), ("satisfactory.exe", "Satisfactory"), ("factorygame-win64-shipping.exe", "Satisfactory"),
  ("eurotrucks2.exe", "Euro Truck Simulator 2"), ("cities.exe", "Cities: Skylines"), ("cities2.exe", "Cities: Skylines II"),
  ("civilizationvi.exe", "Sid Meier's Civilization VI"), ("eu4.exe", "Europa Universalis IV"), ("hoi4.exe", "Hearts of Iron IV"),
  ("sotgame.exe", "Sea of Thieves"), ("forzahorizon5.exe", "Forza Horizon 5"), ("acc.exe", "Assetto Corsa Competizione"),
  ("fc25.exe", "EA SPORTS FC 25"), ("fc24.exe", "EA SPORTS FC 24"), ("nba2k25.exe", "NBA 2K25"), ("thefinals.exe", "THE FINALS"),
  ("marvelrivals_launcher.exe", "Marvel Rivals"), ("marvel-win64-shipping.exe", "Marvel Rivals"), ("deadlock.exe", "Deadlock"),
  ("hollow_knight.exe", "Hollow Knight"), ("hades.exe", "Hades"), ("hades2.exe", "Hades II"), ("celeste.exe", "Celeste"),
  ("sims4.exe", "The Sims 4"), ("ts4_x64.exe", "The Sims 4"), ("subnautica.exe", "Subnautica"), ("nms.exe", "No Man's Sky"),
  ("monsterhunterwilds.exe", "Monster Hunter Wilds"), ("monsterhunterworld.exe", "Monster Hunter: World"), ("sekiro.exe", "Sekiro: Shadows Die Twice"),
  ("darksoulsiii.exe", "DARK SOULS III"), ("re4.exe", "Resident Evil 4"), ("spider-man.exe", "Marvel's Spider-Man"), ("hogwartslegacy.exe", "Hogwarts Legacy"),
];

#[cfg(windows)]
pub fn running() -> Option<&'static str> {
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
  unsafe {
    let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
    let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
    let mut found = None;
    if Process32FirstW(snap, &mut e).is_ok() {
      loop {
        let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
        let name = String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase();
        if let Some((_, game)) = GAMES.iter().find(|(exe, _)| *exe == name) { found = Some(*game); break; }
        if Process32NextW(snap, &mut e).is_err() { break; }
      }
    }
    let _ = CloseHandle(snap);
    found
  }
}
#[cfg(not(windows))]
pub fn running() -> Option<&'static str> { None }
