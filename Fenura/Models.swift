import Foundation

struct Track: Identifiable, Hashable, Codable {
    var id: String { "\(ownerId)_\(audioId)" }
    let ownerId: Int
    let audioId: Int
    let artist: String
    let title: String
    let duration: Int
    var url: String
    let artworkURL: URL?
    let accessKey: String?
    var isAdded: Bool
}

struct Playlist: Identifiable, Hashable, Codable {
    var id: String { "\(ownerId)_\(playlistId)" }
    let ownerId: Int
    let playlistId: Int
    let title: String
    let subtitle: String
    let count: Int
    let artworkURL: URL?
    let accessKey: String?
}

struct UserProfile: Hashable, Codable {
    let id: Int
    let firstName: String
    let lastName: String
    let photoURL: URL?

    var displayName: String {
        "\(firstName) \(lastName)".trimmingCharacters(in: .whitespaces)
    }

    var initials: String {
        let f = firstName.first.map(String.init) ?? "F"
        let l = lastName.first.map(String.init) ?? ""
        return (f + l).uppercased()
    }
}

enum LibrarySection: Hashable {
    case myMusic
    case recommendations
    case popular
    case search
    case playlist(Playlist)
}

enum RepeatMode: String, Codable {
    case off
    case all
    case one
}

struct AuthChallenge: Equatable {
    enum Kind: Equatable {
        case twoFactor(sid: String, type: String, message: String)
        case captcha(sid: String, imageURL: URL?, redirectURL: URL?)
    }

    let kind: Kind
    let login: String
    let password: String
}

struct SearchBundle {
    var tracks: [Track] = []
    var playlists: [Playlist] = []
}
