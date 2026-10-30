import SwiftUI

private enum Palette {
    static let ink = Color(red: 0.16, green: 0.20, blue: 0.20)
    static let muted = Color(red: 0.45, green: 0.51, blue: 0.50)
    static let green = Color(red: 0.18, green: 0.43, blue: 0.36)
    static let mint = Color(red: 0.89, green: 0.95, blue: 0.91)
    static let cream = Color(red: 0.97, green: 0.96, blue: 0.92)
    static let orange = Color(red: 0.86, green: 0.48, blue: 0.25)
}

private struct Observation: Identifiable, Codable {
    var id = UUID()
    var date = Date()
    var appetite = "Хороший"
    var activity = "Обычная"
    var water = "Пила"
    var note = ""
}

private struct CareTask: Identifiable, Codable {
    var id = UUID()
    var title: String
    var detail: String
    var done = false
}

private enum Store {
    static func load<T: Decodable>(_ type: T.Type, key: String, fallback: T) -> T {
        guard let data = UserDefaults.standard.data(forKey: key),
              let value = try? JSONDecoder().decode(type, from: data) else { return fallback }
        return value
    }
    static func save<T: Encodable>(_ value: T, key: String) {
        if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: key) }
    }
}

struct ContentView: View {
    @State private var tab = 0
    @State private var observations = Store.load([Observation].self, key: "observations", fallback: [Observation]())
    @State private var tasks = Store.load([CareTask].self, key: "tasks", fallback: [
        CareTask(title: "Свежая вода", detail: "Проверить поилку"),
        CareTask(title: "Сено", detail: "Должно быть доступно постоянно"),
        CareTask(title: "Время для активности", detail: "Безопасный выгул вечером"),
        CareTask(title: "Песочная ванна", detail: "Короткий сеанс, чистый песок")
    ])
    @State private var showingEntry = false
    @State private var weight = UserDefaults.standard.double(forKey: "weight") == 0 ? 520.0 : UserDefaults.standard.double(forKey: "weight")
    @State private var showingWeight = false

    private var todayCount: Int { observations.filter { Calendar.current.isDateInToday($0.date) }.count }
    private var doneCount: Int { tasks.filter(\.done).count }

    var body: some View {
        ZStack {
            Palette.cream.ignoresSafeArea()
            Group {
                switch tab {
                case 0: home
                case 1: journal
                case 2: care
                default: profile
                }
            }
        }
        .safeAreaInset(edge: .bottom) { tabBar }
        .tint(Palette.green)
        .sheet(isPresented: $showingEntry) {
            NewObservationSheet { item in
                observations.insert(item, at: 0)
                Store.save(observations, key: "observations")
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showingWeight) {
            WeightSheet(weight: weight) { newValue in
                weight = newValue
                UserDefaults.standard.set(newValue, forKey: "weight")
            }
            .presentationDetents([.height(330)])
        }
        .onChange(of: tasks) { newValue in Store.save(newValue, key: "tasks") }
    }

    private var home: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)).capitalized)
                            .font(.subheadline).foregroundStyle(Palette.muted)
                        Text("Привет, заботливый друг")
                            .font(.system(size: 25, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink)
                    }
                    Spacer()
                    Image(systemName: "bell.badge")
                        .font(.title3).foregroundStyle(Palette.green).padding(12)
                        .background(.white, in: Circle())
                }
                heroCard
                HStack(spacing: 12) {
                    metricCard(icon: "scalemass", title: "Вес", value: "\(Int(weight)) г", detail: "последнее измерение", action: { showingWeight = true })
                    metricCard(icon: "eye", title: "Наблюдения", value: "\(todayCount)", detail: "записано сегодня", action: { tab = 1 })
                }
                HStack {
                    Text("План на сегодня").font(.system(size: 20, weight: .bold, design: .rounded))
                    Spacer()
                    Text("\(doneCount)/\(tasks.count)").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.green)
                }
                VStack(spacing: 0) {
                    ForEach(tasks.indices, id: \.self) { index in
                        Button { tasks[index].done.toggle() } label: {
                            HStack(spacing: 13) {
                                Image(systemName: tasks[index].done ? "checkmark.circle.fill" : "circle")
                                    .font(.title2).foregroundStyle(tasks[index].done ? Palette.green : Palette.muted)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(tasks[index].title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                                    Text(tasks[index].detail).font(.caption).foregroundStyle(Palette.muted)
                                }
                                Spacer()
                            }.padding(.vertical, 12).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        if index < tasks.count - 1 { Divider().padding(.leading, 42) }
                    }
                }.padding(.horizontal, 15).background(.white, in: RoundedRectangle(cornerRadius: 20))
                Button { showingEntry = true } label: {
                    Label("Добавить наблюдение", systemImage: "plus")
                        .font(.headline).foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(Palette.green, in: RoundedRectangle(cornerRadius: 17))
                }
                Text("Наблюдение — не диагноз. При тревожных симптомах свяжитесь с ветеринаром.")
                    .font(.caption).foregroundStyle(Palette.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity)
            }.padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 24)
        }
    }

    private var heroCard: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 26).fill(Palette.green.gradient)
            Circle().fill(.white.opacity(0.08)).frame(width: 185).offset(x: 215, y: -50)
            VStack(alignment: .leading, spacing: 12) {
                Text("ТВОЙ МАЛЕНЬКИЙ ДРУГ").font(.caption2.weight(.bold)).tracking(1.6).foregroundStyle(.white.opacity(0.72))
                Text("Чипа").font(.system(size: 34, weight: .bold, design: .rounded)).foregroundStyle(.white)
                HStack(spacing: 6) {
                    Circle().fill(Color(red: 0.67, green: 0.91, blue: 0.69)).frame(width: 8, height: 8)
                    Text("Сегодня под наблюдением").font(.subheadline).foregroundStyle(.white.opacity(0.9))
                }
                Text("Как прошёл её день?").font(.caption).foregroundStyle(.white.opacity(0.7)).padding(.top, 4)
            }.padding(22)
            Text("🐭").font(.system(size: 76)).rotationEffect(.degrees(-8)).offset(x: 235, y: 17)
        }.frame(height: 180).clipShape(RoundedRectangle(cornerRadius: 26))
    }

    private func metricCard(icon: String, title: String, value: String, detail: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: icon).font(.headline).foregroundStyle(Palette.green).frame(width: 34, height: 34).background(Palette.mint, in: Circle())
                Text(title).font(.caption).foregroundStyle(Palette.muted)
                Text(value).font(.title2.weight(.bold)).foregroundStyle(Palette.ink)
                Text(detail).font(.system(size: 10)).foregroundStyle(Palette.muted).lineLimit(1)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(15).background(.white, in: RoundedRectangle(cornerRadius: 20))
        }.buttonStyle(.plain)
    }

    private var journal: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Замечайте перемены — короткие записи помогают увидеть динамику.")
                        .font(.subheadline).foregroundStyle(Palette.muted)
                    Button { showingEntry = true } label: {
                        Label("Новое наблюдение", systemImage: "plus.circle.fill").font(.headline)
                            .frame(maxWidth: .infinity).padding(15).foregroundStyle(.white).background(Palette.green, in: RoundedRectangle(cornerRadius: 16))
                    }.buttonStyle(.plain)
                    if observations.isEmpty {
                        emptyState(icon: "text.book.closed", title: "Записей пока нет", detail: "Добавьте первое наблюдение о самочувствии Чипы.")
                    } else {
                        ForEach(observations) { item in
                            VStack(alignment: .leading, spacing: 12) {
                                HStack { Text(item.date.formatted(date: .abbreviated, time: .shortened)).font(.caption.weight(.medium)).foregroundStyle(Palette.muted); Spacer(); Image(systemName: "sparkle").foregroundStyle(Palette.orange) }
                                HStack(spacing: 8) { tag("Аппетит", item.appetite); tag("Активность", item.activity); tag("Вода", item.water) }
                                if !item.note.isEmpty { Text(item.note).font(.subheadline).foregroundStyle(Palette.ink) }
                            }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 18))
                        }
                    }
                    warningCard
                }.padding(20)
            }.background(Palette.cream).navigationTitle("Наблюдения")
        }
    }

    private var care: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Небольшая рутина помогает заметить, что изменилось.").font(.subheadline).foregroundStyle(Palette.muted)
                    Text("Ежедневно").font(.title3.bold())
                    ForEach(tasks.indices, id: \.self) { index in
                        Button { tasks[index].done.toggle() } label: {
                            HStack(spacing: 14) {
                                Image(systemName: tasks[index].done ? "checkmark.circle.fill" : "circle").font(.title2).foregroundStyle(tasks[index].done ? Palette.green : Palette.muted)
                                VStack(alignment: .leading, spacing: 5) { Text(tasks[index].title).font(.headline).foregroundStyle(Palette.ink); Text(tasks[index].detail).font(.caption).foregroundStyle(Palette.muted) }
                                Spacer()
                            }.padding(16).background(.white, in: RoundedRectangle(cornerRadius: 17))
                        }.buttonStyle(.plain)
                    }
                    warningCard
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Полезная привычка", systemImage: "lightbulb.fill").font(.headline).foregroundStyle(Palette.green)
                        Text("Взвешивайте питомца примерно в одно и то же время и записывайте результат. Важна динамика, а не отдельная цифра.").font(.subheadline).foregroundStyle(Palette.ink)
                    }.padding(17).background(Palette.mint, in: RoundedRectangle(cornerRadius: 18))
                }.padding(20)
            }.background(Palette.cream).navigationTitle("Уход")
        }
    }

    private var profile: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Text("🐭").font(.system(size: 82)).frame(maxWidth: .infinity).padding(.vertical, 30).background(Palette.mint, in: RoundedRectangle(cornerRadius: 24))
                    VStack(spacing: 5) { Text("Чипа").font(.title.bold()); Text("Шиншилла · мой питомец").font(.subheadline).foregroundStyle(Palette.muted) }
                    Button { showingWeight = true } label: {
                        HStack { Label("Последний вес", systemImage: "scalemass"); Spacer(); Text("\(Int(weight)) г").foregroundStyle(Palette.green).bold(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(Palette.muted) }
                            .padding(17).background(.white, in: RoundedRectangle(cornerRadius: 16))
                    }.buttonStyle(.plain)
                    VStack(alignment: .leading, spacing: 9) {
                        Text("Важно знать").font(.headline)
                        Text("Шиншиллам важно прохладное, сухое и хорошо проветриваемое помещение. Не купайте в воде. Если питомец перестал есть, стал необычно вялым или тяжело дышит — не ждите, обратитесь к ветеринару, который работает с экзотическими животными.")
                            .font(.subheadline).foregroundStyle(Palette.muted)
                    }.padding(17).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 18))
                    Text("Все записи сохраняются только на этом устройстве.").font(.caption).foregroundStyle(Palette.muted)
                }.padding(20)
            }.background(Palette.cream).navigationTitle("Питомец")
        }
    }

    private var warningCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "cross.case.fill").foregroundStyle(Palette.orange).font(.title3)
            VStack(alignment: .leading, spacing: 5) {
                Text("Когда нужен ветеринар").font(.subheadline.bold()).foregroundStyle(Palette.ink)
                Text("Отказ от еды, заметное снижение веса, необычный стул, слюнотечение, затруднённое дыхание или резкая вялость — повод оперативно связаться со специалистом по экзотическим животным.").font(.caption).foregroundStyle(Palette.muted)
            }
        }.padding(15).frame(maxWidth: .infinity, alignment: .leading).background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 17))
    }

    private func tag(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) { Text(title).font(.system(size: 9)).foregroundStyle(Palette.muted); Text(value).font(.caption2.bold()).foregroundStyle(Palette.ink) }
            .padding(.horizontal, 9).padding(.vertical, 7).background(Palette.cream, in: RoundedRectangle(cornerRadius: 9))
    }

    private func emptyState(icon: String, title: String, detail: String) -> some View {
        VStack(spacing: 10) { Image(systemName: icon).font(.largeTitle).foregroundStyle(Palette.green); Text(title).font(.headline); Text(detail).font(.subheadline).foregroundStyle(Palette.muted).multilineTextAlignment(.center) }
            .frame(maxWidth: .infinity).padding(28).background(.white, in: RoundedRectangle(cornerRadius: 20))
    }

    private var tabBar: some View {
        HStack {
            tabButton("Главная", icon: "house.fill", index: 0)
            tabButton("Журнал", icon: "book.closed.fill", index: 1)
            tabButton("Уход", icon: "checklist", index: 2)
            tabButton("Питомец", icon: "pawprint.fill", index: 3)
        }.padding(.top, 11).padding(.bottom, 5).background(.regularMaterial)
    }
    private func tabButton(_ title: String, icon: String, index: Int) -> some View {
        Button { tab = index } label: {
            VStack(spacing: 4) { Image(systemName: icon).font(.system(size: 18, weight: .semibold)); Text(title).font(.system(size: 10, weight: .medium)) }
                .foregroundStyle(tab == index ? Palette.green : Palette.muted).frame(maxWidth: .infinity)
        }.buttonStyle(.plain)
    }
}

private struct NewObservationSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var appetite = "Хороший"
    @State private var activity = "Обычная"
    @State private var water = "Пила"
    @State private var note = ""
    let onSave: (Observation) -> Void
    private let appetites = ["Хороший", "Меньше", "Не ела"]
    private let activities = ["Обычная", "Активная", "Вялая"]
    private let waters = ["Пила", "Мало", "Не заметил"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Сегодняшнее состояние") {
                    Picker("Аппетит", selection: $appetite) { ForEach(appetites, id: \.self) { Text($0) } }
                    Picker("Активность", selection: $activity) { ForEach(activities, id: \.self) { Text($0) } }
                    Picker("Вода", selection: $water) { ForEach(waters, id: \.self) { Text($0) } }
                }
                Section("Заметка") { TextField("Например: играла дольше обычного", text: $note, axis: .vertical).lineLimit(2...4) }
            }
            .navigationTitle("Новое наблюдение").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Сохранить") { onSave(Observation(appetite: appetite, activity: activity, water: water, note: note)); dismiss() }.bold() }
            }
        }
    }
}

private struct WeightSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State var weight: Double
    let onSave: (Double) -> Void
    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                Text("Вес Чипы").font(.title2.bold())
                Text("\(Int(weight)) г").font(.system(size: 42, weight: .bold, design: .rounded)).foregroundStyle(Palette.green)
                Slider(value: $weight, in: 250...1000, step: 1).tint(Palette.green).padding(.horizontal, 22)
                Text("Это журнал измерений, а не медицинская оценка. Для оценки веса питомца проконсультируйтесь с ветеринаром.").font(.caption).foregroundStyle(Palette.muted).multilineTextAlignment(.center).padding(.horizontal)
                Spacer()
            }.padding(.top, 28).toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { onSave(weight); dismiss() }.bold() } }
        }
    }
}
