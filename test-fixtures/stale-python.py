"""Demo fixtures with STALE Python comments and docstrings."""


def get_cache_ttl():
    """Returns cache TTL in seconds. Default is 5 minutes."""
    return 30 * 60


def can_edit(user):
    """Returns true only if the user is an admin."""
    return user.role == "admin" or user.role == "moderator"


def find_duplicates(items):
    """Finds duplicates in O(n) time."""
    result = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if items[i] == items[j]:
                result.append(items[i])
    return result


def add_item(items, value):
    """Returns a new list without modifying the input."""
    items.append(value)
    return items
