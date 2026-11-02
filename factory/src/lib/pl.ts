/** Polish UI text. Keys are the English strings used in t(). */
export const PL: Record<string, string> = {
  // Navigation & roles
  "Home": "Start", "Jobs": "Zlecenia", "Time": "Czas", "Team": "Zespół", "Requests": "Wnioski", "Insights": "Analizy",
  "Issues": "Problemy", "Stock": "Magazyn", "Profile": "Profil", "Settings": "Ustawienia", "Awards": "Nagrody",
  "Boss": "Szef", "Manager": "Kierownik", "Office": "Biuro", "Assistant": "Asystent", "Operator": "Operator",
  "Full control, live floor, insights": "Pełna kontrola, hala na żywo, analizy",
  "Plan jobs, run the team, approve": "Planowanie zleceń, zespół, akceptacje",
  "Timesheets, absences, stock, news": "Ewidencja czasu, nieobecności, magazyn, ogłoszenia",
  "Jobs, stock keeping, help the line": "Zlecenia, magazyn, wsparcie linii",
  "Clock in, run jobs, team up": "Rejestracja czasu, zlecenia, praca w zespole",
  "Role": "Rola",

  // Greeting & home
  "Good morning": "Dzień dobry", "Good afternoon": "Dzień dobry", "Good evening": "Dobry wieczór", "Night shift": "Nocna zmiana",
  "Have a wonderful day!": "Miłego dnia!", "Refresh": "Odśwież", "Today": "Dzisiaj", "Today's shift": "Dzisiejsza zmiana",
  "Clock in": "Rozpocznij pracę", "Clock out": "Koniec pracy", "Start your shift": "Rozpocznij zmianę",
  "Clocked in": "W pracy", "On break": "Na przerwie", "Break": "Przerwa", "End break": "Koniec przerwy",
  "Hold to clock out": "Przytrzymaj, by zakończyć", "Started": "Początek", "Finish around": "Koniec około",
  "worked today": "przepracowane dziś", "overtime": "nadgodzin", "Breaks today": "Przerwy dziś",
  "In progress": "W toku", "Open tasks": "Otwarte", "Blocked": "Zablokowane",
  "Priority jobs": "Priorytetowe zlecenia", "Start at the top.": "Zacznij od góry.",
  "All clear": "Wszystko zrobione", "No production jobs are assigned to you yet.": "Nie masz jeszcze przypisanych zleceń.",
  "See all {n} jobs": "Zobacz wszystkie ({n})", "On the floor": "Na hali", "Nobody has clocked in yet.": "Nikt jeszcze nie rozpoczął pracy.",
  "break": "przerwa", "free": "wolny", "Noticeboard": "Tablica ogłoszeń", "Share an update with everyone…": "Napisz ogłoszenie dla wszystkich…",
  "Pin": "Przypnij", "Post": "Opublikuj", "Delete": "Usuń",
  "On shift": "Na zmianie", "Live jobs": "Zlecenia w toku", "Person-hours today": "Roboczogodziny dziś",
  "Team jobs today": "Zlecenia zespołowe dziś", "Open issues": "Otwarte problemy", "Waiting for you": "Czeka na Ciebie",
  "Low stock": "Niski stan", "Live floor": "Hala na żywo", "Every job running right now, with its crew": "Wszystkie trwające zlecenia i ich ekipy",
  "Quiet floor": "Na hali spokojnie", "No jobs are being worked on right now.": "Teraz nikt nie pracuje przy zleceniu.",
  "1 person": "1 osoba", "{n} people": "{n} os.", "person-hours": "roboczogodzin",

  // Live job / player
  "Live": "Na żywo", "no estimate": "brak szacunku", "Invite a helper": "Zaproś pomocnika", "Leave job": "Opuść zlecenie",
  "Pause": "Wstrzymaj", "Hold to complete": "Przytrzymaj, by zakończyć", "Details": "Szczegóły", "Report issue": "Zgłoś problem",
  "Hold the red button to complete": "Przytrzymaj czerwony przycisk, by zakończyć", "You": "Ty", "Crew": "Ekipa",
  "Person-hours": "Roboczogodziny", "invited": "zaproszony", "Cancel invite": "Anuluj zaproszenie", "Invite": "Zaproś",
  "They get an invite on their phone. Once they join, everyone's time is counted, so the boss sees the real crew size and person-hours.":
    "Dostaną zaproszenie na telefon. Po dołączeniu liczy się czas każdej osoby, więc szef widzi faktyczną wielkość ekipy i roboczogodziny.",
  "Search staff…": "Szukaj pracownika…", "Invite pending": "Zaproszenie wysłane", "On {code}": "Przy {code}",
  "Free · on shift": "Wolny · na zmianie", "Off shift": "Poza zmianą", "Send {n} invite(s)": "Wyślij zaproszenia ({n})",
  "Pick someone": "Wybierz osobę", "Team invite": "Zaproszenie do zespołu", "{name} needs a hand": "{name} potrzebuje pomocy",
  "Not now": "Nie teraz", "Join job": "Dołącz", "due": "termin",

  // Job statuses & priority
  "Open": "Otwarte", "Paused": "Wstrzymane", "Done": "Gotowe",
  "Urgent": "Pilne", "High": "Wysoki", "Normal": "Normalny", "Low": "Niski", "Backlog": "Kiedyś",

  // Jobs screen & sheet
  "All jobs": "Wszystkie zlecenia", "My jobs": "Moje zlecenia", "Sorted by manufacturing priority": "Według priorytetu produkcji",
  "Active": "Aktywne", "Search code, title, customer…": "Szukaj kodu, nazwy, klienta…", "Whole floor": "Cała hala", "Mine only": "Tylko moje",
  "Nothing finished yet": "Nic jeszcze nie ukończono", "No jobs here": "Brak zleceń", "Try clearing filters.": "Spróbuj wyczyścić filtry.",
  "New job": "Nowe zlecenie", "Qty": "Ilość", "Due": "Termin", "Team job · up to {n}": "Zlecenie zespołowe · do {n} os.",
  "Job time": "Czas zlecenia", "clock on the job": "zegar zlecenia", "everyone combined": "wszyscy razem", "Estimate": "Szacunek",
  "{n}% used": "wykorzystano {n}%", "not set": "nie ustawiono", "Join the crew ({n} working)": "Dołącz do ekipy (pracuje: {n})",
  "Switch to this job": "Przełącz na to zlecenie", "Start job": "Rozpocznij zlecenie", "Clock in & start job": "Zacznij pracę i zlecenie",
  "This job is blocked by an issue.": "Zlecenie jest zablokowane przez problem.",
  "Not assigned to you. Ask a teammate to invite you.": "Nie jest przypisane do Ciebie. Poproś kogoś z ekipy o zaproszenie.",
  "Unblock": "Odblokuj", "Reopen job": "Otwórz ponownie", "Who put time in": "Kto pracował", "Timeline": "Historia", "now": "teraz",
  "{n} people · {time} person-time": "{n} os. · {time} łącznie", "Assigned": "Przypisani", "Nobody yet": "Jeszcze nikt",
  "Edit": "Edytuj", "Hold to delete": "Przytrzymaj, by usunąć", "Edit {code}": "Edytuj {code}", "Title": "Nazwa",
  "e.g. Control board rev D — SMT": "np. Płyta sterująca rev D — SMT", "Customer": "Klient", "Optional": "Opcjonalnie",
  "Instructions": "Instrukcje", "Drawing refs, checks, torque values…": "Rysunki, kontrole, momenty dokręcania…", "Priority": "Priorytet",
  "Estimate (hours)": "Szacunek (godziny)", "Quantity": "Ilość", "Due date": "Termin", "Assign to": "Przypisz do",
  "Save changes": "Zapisz zmiany", "Create job": "Utwórz zlecenie",

  // Time
  "Time sheet": "Ewidencja czasu", "Your hours, breaks and overtime": "Twoje godziny, przerwy i nadgodziny",
  "Day": "Dzień", "Week": "Tydzień", "Month": "Miesiąc", "Previous": "Poprzedni", "Next": "Następny",
  "Total": "Razem", "Normal hours": "Normalne", "Overtime": "Nadgodziny", "Days": "Dni",
  "Correct shift": "Popraw zmianę", "No shifts": "Brak zmian", "Nothing recorded in this period.": "Brak wpisów w tym okresie.",
  "Export CSV": "Eksportuj CSV", "Leave empty if still on shift": "Zostaw puste, jeśli zmiana trwa", "Save correction": "Zapisz poprawkę",
  "Employee": "Pracownik", "Code": "Kod", "Date": "Data", "Breaks (min)": "Przerwy (min)", "Worked (h)": "Przepracowane (h)",

  // Issues
  "Production issue": "Problem produkcyjny", "Machine down, missing parts, quality or safety — flag it in seconds.":
    "Awaria maszyny, brak części, jakość albo BHP — zgłoś w kilka sekund.",
  "Report a problem": "Zgłoś problem", "Issue log": "Rejestr problemów", "Resolved": "Rozwiązane",
  "Machine": "Maszyna", "Material": "Materiał", "Quality": "Jakość", "Safety": "BHP", "Tooling": "Narzędzia", "Other": "Inne",
  "Medium": "Średni", "Critical": "Krytyczny", "Acknowledged": "Przyjęte", "Resolved by {name}": "Rozwiązał(a): {name}",
  "On it": "Zajmuję się", "Resolve": "Rozwiąż", "No open issues": "Brak otwartych problemów", "Nothing resolved yet": "Nic jeszcze nie rozwiązano",
  "Smooth running. Long may it last.": "Wszystko działa. Oby tak dalej.", "Report an issue": "Zgłoś problem", "Linked job": "Powiązane zlecenie",
  "General (not job-specific)": "Ogólne (bez zlecenia)", "What kind?": "Jaki rodzaj?", "How bad?": "Jak poważny?",
  "Short title": "Krótki opis", "e.g. Feeder 4 jamming": "np. Zacina się podajnik 4",
  "What happened, what you tried…": "Co się stało, co już sprawdzono…", "Block this job": "Zablokuj zlecenie",
  "Stops the timer and flags it red": "Zatrzymuje czas i oznacza na czerwono", "Send report": "Wyślij zgłoszenie",

  // Stock
  "Tap − / + to book parts in and out.": "Stuknij − / +, aby przyjąć lub wydać części.",
  "Read-only — ask an assistant or the office to adjust stock.": "Tylko podgląd — zmiany stanu robi asystent lub biuro.",
  "Search SKU, part, location…": "Szukaj indeksu, części, lokalizacji…", "Remove one": "Odejmij jeden", "Add one": "Dodaj jeden",
  "Nothing found": "Nic nie znaleziono", "No items below minimum": "Nic poniżej minimum", "Try another search.": "Spróbuj innego wyszukiwania.",
  "Add item": "Dodaj pozycję", "Add stock item": "Nowa pozycja", "Edit stock": "Edytuj stan", "Book in / out": "Przyjęcie / wydanie",
  "e.g. +250 delivery or −40 issued to line": "np. +250 dostawa albo −40 wydane na linię", "Apply": "Zastosuj",
  "Location": "Lokalizacja", "Name": "Nazwa", "Minimum": "Minimum", "Unit": "Jednostka", "Save": "Zapisz",

  // Requests / absences
  "Absences and new starters waiting for you": "Nieobecności i nowe osoby czekające na Ciebie", "Pending": "Oczekujące",
  "Upcoming": "Nadchodzące", "History": "Historia", "Away today": "Nieobecni dziś", "Absence requests": "Wnioski o nieobecność",
  "Nothing waiting": "Nic nie czeka", "Nothing here": "Pusto", "No requests waiting for a decision.": "Brak wniosków do decyzji.",
  "Reject": "Odrzuć", "Approve": "Zatwierdź", "Off-sick": "Chorobowe", "Day off": "Dzień wolny", "Day-off": "Dzień wolny", "Holiday": "Urlop",
  "Holidays": "Urlop", "pending": "oczekuje", "approved": "zatwierdzony", "rejected": "odrzucony", "cancelled": "anulowany",
  "Absence": "Nieobecność", "Request off-sick": "Zgłoś chorobowe", "Request day-off": "Wniosek o dzień wolny", "Request holidays": "Wniosek o urlop",
  "From": "Od", "To": "Do", "Note (optional)": "Uwagi (opcjonalnie)", "How are you feeling?": "Jak się czujesz?",
  "Anything your manager should know": "Coś, o czym kierownik powinien wiedzieć", "Send": "Wyślij", "My requests": "Moje wnioski",
  "Cancel request": "Anuluj wniosek", "{n} left": "zostało {n}",

  // Insights
  "Where the hours go, and who teams up": "Na co idą godziny i kto pracuje razem", "7 days": "7 dni", "30 days": "30 dni",
  "Person-hours on jobs": "Roboczogodziny na zleceniach", "Hours worked in teams": "Godziny pracy zespołowej",
  "Job clock time": "Czas zleceń", "Jobs completed": "Ukończone zlecenia", "Time used vs estimate": "Czas wobec szacunku",
  "Jobs by effort": "Zlecenia wg nakładu", "Job time vs person-hours. Team jobs use more hands than the clock shows.":
    "Czas zlecenia a roboczogodziny. Przy pracy zespołowej rąk jest więcej, niż pokazuje zegar.",
  "{n} team run(s)": "pracy zespołowej: {n}", "No job time yet": "Brak czasu na zleceniach",
  "Once people start jobs, the effort shows up here.": "Gdy ktoś zacznie zlecenie, nakład pojawi się tutaj.",
  "Hours by person": "Godziny wg osoby", "Shift time, with the part spent on jobs": "Czas zmiany i część przepracowana przy zleceniach",
  "Shift": "Zmiana", "On jobs": "Przy zleceniach",

  // Team, approvals & invite links
  "{n} on shift": "{n} na zmianie", "Invite links": "Linki zaproszeń", "Invite new starters": "Zaproś nowe osoby",
  "Search name or code…": "Szukaj imienia lub kodu…", "Working on {code}": "Pracuje przy {code}", "On shift · free": "Na zmianie · wolny",
  "today": "dziś", "Waiting for approval": "Czeka na akceptację", "Signed up without an invite link": "Zarejestrowani bez linku zaproszenia",
  "signed up {when}": "rejestracja {when}", "Remove": "Usuń", "Share this link": "Udostępnij link",
  "New starters open the link, type the PIN you set here, and create their account. No approval needed afterwards.":
    "Nowa osoba otwiera link, wpisuje ustawiony tutaj PIN i zakłada konto. Potem nie trzeba już akceptacji.",
  "They join as": "Dołączają jako", "PIN (4–8 digits)": "PIN (4–8 cyfr)",
  "Tell people the PIN in person — not in the same message as the link.": "Przekaż PIN osobiście — nie w tej samej wiadomości co link.",
  "Random": "Losuj", "Link works for": "Link ważny przez", "24 hours": "24 godziny",
  "How many people can use it": "Ile osób może go użyć", "No limit": "Bez limitu", "Create link": "Utwórz link",
  "Active links": "Aktywne linki", "used {n}": "użyty {n}", "until {date}": "do {date}", "locked": "zablokowany",
  "Show": "Pokaż", "Switch off": "Wyłącz", "Copied": "Skopiowano", "Scan with a phone camera, or send the link.": "Zeskanuj aparatem telefonu albo wyślij link.",
  "Copy": "Kopiuj", "PIN": "PIN", "Share": "Udostępnij", "Join the Skalarki Factory app": "Dołącz do aplikacji Skalarki Factory",
  "Team member": "Pracownik", "Working": "Pracuje", "This month": "Ten miesiąc", "Team jobs": "Zlecenia zespołowe",
  "Holiday allowance · {used} of {total} used this year": "Urlop · wykorzystano {used} z {total} w tym roku", "Set": "Ustaw",

  // Profile, awards, settings
  "Change photo": "Zmień zdjęcie", "Tap to edit": "Stuknij, by edytować", "New profile photo": "Nowe zdjęcie profilowe",
  "Remove current": "Usuń obecne", "Use this photo": "Użyj tego zdjęcia", "Hours this month": "Godziny w tym miesiącu",
  "Completed jobs": "Ukończone zlecenia", "Rewards achieved": "Zdobyte nagrody", "Next up": "Następne", "Progress": "Postęp",
  "Your first award is close — check the list below.": "Pierwsza nagroda jest blisko — zobacz listę poniżej.",
  "Team Player": "Gracz zespołowy", "Work 5 jobs as a team": "Pracuj w zespole przy 5 zleceniach",
  "Early Bird": "Ranny ptaszek", "Clock in by 06:15 five times": "Zacznij pracę do 06:15 pięć razy",
  "Finisher": "Finiszer", "Help complete 10 jobs": "Pomóż ukończyć 10 zleceń",
  "Iron Shift": "Żelazna zmiana", "Work a 9-hour day": "Przepracuj 9 godzin w jeden dzień",
  "Eagle Eye": "Sokole oko", "Report 3 issues": "Zgłoś 3 problemy", "Regular": "Stały bywalec", "Clock 20 shifts": "Przepracuj 20 zmian",
  "Language": "Język", "Text & layout size": "Rozmiar tekstu", "Bigger for gloves and tablets": "Większy do rękawic i tabletów",
  "Background": "Tło", "Night blue or deeper": "Granat albo ciemniejszy", "Night": "Granat", "Deep": "Ciemny",
  "Start screen": "Ekran startowy", "Tab shown when the app opens": "Karta po otwarciu aplikacji",
  "Reduce animations": "Mniej animacji", "Open panels instantly": "Panele otwierają się od razu",
  "Vibration": "Wibracje", "Short buzz on taps (Android)": "Krótka wibracja przy dotyku (Android)",
  "Sounds": "Dźwięki", "Soft clicks on actions": "Ciche kliknięcia przy akcjach", "Update app": "Aktualizuj aplikację",
  "cloud sync": "synchronizacja w chmurze", "Reload": "Odśwież", "Sign out": "Wyloguj",
  "Back": "Wstecz", "Close": "Zamknij", "Hold to confirm": "Przytrzymaj, by potwierdzić",

  // Login, join, pending
  "Sign in": "Zaloguj", "New starter": "Nowa osoba", "Full name": "Imię i nazwisko", "Work email": "E-mail służbowy",
  "Password": "Hasło", "Create account": "Załóż konto", "Forgot password?": "Nie pamiętasz hasła?", "Type your email first": "Najpierw wpisz e-mail",
  "Reset link sent": "Wysłano link do zmiany hasła", "Check your email to confirm your account": "Sprawdź e-mail, aby potwierdzić konto",
  "Got an invite link from work? Open it instead — it skips the approval wait.": "Masz link zaproszenia z pracy? Otwórz go — nie trzeba czekać na akceptację.",
  
  
  
  "Could not sign in": "Nie udało się zalogować", "Use at least 8 characters for your password": "Hasło musi mieć co najmniej 8 znaków",
  "Opening invite…": "Otwieram zaproszenie…", "Back to sign in": "Wróć do logowania", "You're invited": "Masz zaproszenie",
  "{name} invited you to join as": "{name} zaprasza Cię jako", "You're invited to join as": "Zaproszenie do dołączenia jako",
  "Enter the PIN you were given": "Wpisz otrzymany PIN", "Wrong PIN — try again": "Zły PIN — spróbuj ponownie", "Continue": "Dalej",
  "Create your account": "Załóż konto", "Email": "E-mail", "Password (8+ characters)": "Hasło (min. 8 znaków)", "Join": "Dołącz",
  "Check your email": "Sprawdź skrzynkę", "Confirm your address, then sign in. Your invite is saved on this phone and applied automatically.":
    "Potwierdź adres, potem się zaloguj. Zaproszenie jest zapisane na tym telefonie i zostanie użyte automatycznie.",
  "Go to sign in": "Przejdź do logowania", "Welcome to the team": "Witamy w zespole", "Almost there, {name}": "Prawie gotowe, {name}",
  "Your account was created without an invite link. A manager or the office needs to approve it — or enter an invite link and PIN below.":
    "Konto zostało założone bez linku zaproszenia. Musi je zatwierdzić kierownik lub biuro — albo wpisz poniżej link i PIN.",
  "Invite link or code": "Link lub kod zaproszenia", "Join with invite": "Dołącz z zaproszeniem",
  "Ask the boss for a new link.": "Poproś szefa o nowy link.",
  "This invite link has expired.": "Ten link zaproszenia wygasł.", "This invite link was switched off.": "Ten link zaproszenia został wyłączony.",
  "This invite link has been used the maximum number of times.": "Ten link został już wykorzystany maksymalną liczbę razy.",
  "Too many wrong PINs — this link is locked.": "Zbyt wiele błędnych PIN-ów — link jest zablokowany.",
  "This invite link doesn't exist.": "Taki link zaproszenia nie istnieje.",
  "Starting up…": "Uruchamianie…", "Syncing the floor…": "Synchronizacja…",
  "You're offline — changes will sync when you reconnect": "Brak sieci — zmiany zsynchronizują się po połączeniu",

  // Toasts & errors
  "Something went wrong": "Coś poszło nie tak", "Clocked in — have a good shift": "Praca rozpoczęta — udanej zmiany",
  "You left the job — your time is saved": "Opuściłeś zlecenie — czas zapisany", "Clocked out — see you next time": "Koniec pracy — do zobaczenia",
  "Welcome back": "Witaj z powrotem", "Enjoy your break": "Miłej przerwy", "{code} started — timer running": "{code} rozpoczęte — czas leci",
  "{code} complete — nice work": "{code} ukończone — dobra robota", "{code} paused": "{code} wstrzymane", "{code} marked blocked": "{code} zablokowane",
  "Invite sent to {name}": "Wysłano zaproszenie do: {name}", "{n} invites sent": "Wysłano zaproszenia: {n}",
  "That job has already stopped": "To zlecenie już się zakończyło", "Joined {name} — team timer running": "Dołączono do: {name} — czas zespołu leci",
  "Invite declined": "Zaproszenie odrzucone", "Job updated": "Zlecenie zaktualizowane", "Job created": "Zlecenie utworzone",
  "{code} deleted": "{code} usunięte", "{code} reopened": "{code} otwarte ponownie",
  "Issue reported — the team has been notified": "Problem zgłoszony — zespół został powiadomiony",
  "Issue resolved": "Problem rozwiązany", "Issue acknowledged": "Problem przyjęty", "Stock updated": "Stan zaktualizowany", "Item added": "Pozycja dodana",
  "Get well soon — your manager has been told": "Zdrowiej szybko — kierownik został poinformowany", "Request sent for approval": "Wniosek wysłany do akceptacji",
  "Approved": "Zatwierdzono", "Rejected": "Odrzucono", "Request cancelled": "Wniosek anulowany", "Posted to everyone": "Opublikowano dla wszystkich",
  "Saved": "Zapisano", "New photo saved": "Nowe zdjęcie zapisane", "Shift corrected": "Zmiana poprawiona",
  "Invite link ready": "Link zaproszenia gotowy",
  "Make one link per person. They open it, type the team PIN and create their account — no approval needed afterwards.": "Utwórz osobny link dla każdej osoby. Otwiera go, wpisuje PIN zespołu i zakłada konto — bez czekania na akceptację.",
  "Team PIN (same for every link)": "PIN zespołu (ten sam dla każdego linku)", "Only the boss can create invite links": "Linki zaproszeń może tworzyć tylko szef", "Link switched off": "Link wyłączony", "{name} can now use the app": "{name} może już korzystać z aplikacji",
  "Account removed": "Konto usunięte", "New team invite — check Home": "Nowe zaproszenie do zespołu — zobacz Start",
  "Wrong PIN": "Zły PIN", "This invite link is no longer valid": "Ten link zaproszenia jest już nieważny",
  
  "Only the boss can change roles": "Tylko szef może zmieniać role",
  "Only boss, manager or office can create invite links": "Linki zaproszeń mogą tworzyć tylko szef, kierownik lub biuro",
  "Only the boss can invite boss, manager or office staff": "Tylko szef może zapraszać szefów, kierowników i biuro",
  "PIN must be 4 to 8 digits": "PIN musi mieć od 4 do 8 cyfr", "Invalid login credentials": "Nieprawidłowy e-mail lub hasło",

  // Time words
  "just now": "przed chwilą", "{n}m ago": "{n} min temu", "{n}h ago": "{n} godz. temu", "yesterday": "wczoraj", "{n}d ago": "{n} dni temu",
};
