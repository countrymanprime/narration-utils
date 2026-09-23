package chaptermatch

// sequenceRatio is Python's difflib.SequenceMatcher(None, a, b).ratio():
// 2*M/T, where M is the total size of the matching blocks the
// Ratcliff/Obershelp recursion finds and T the combined length. It has no
// junk function, and difflib's "popular element" heuristic only applies when
// b (the name) has 200 or more characters, so neither is ported: a name
// that long may score differently here than in Python.
func sequenceRatio(a, b string) float64 {
	left, right := []rune(a), []rune(b)
	total := len(left) + len(right)
	if total == 0 {
		return 1
	}
	positions := map[rune][]int{}
	for j, r := range right {
		positions[r] = append(positions[r], j)
	}
	matched := matchingSize(left, right, positions, 0, len(left), 0, len(right))
	return 2 * float64(matched) / float64(total)
}

// matchingSize sums the sizes of get_matching_blocks' blocks within
// a[alo:ahi] and b[blo:bhi]: the longest match, then the same on each side of
// it.
func matchingSize(a, b []rune, positions map[rune][]int, alo, ahi, blo, bhi int) int {
	i, j, size := longestMatch(a, positions, alo, ahi, blo, bhi)
	if size == 0 {
		return 0
	}
	matched := size
	if alo < i && blo < j {
		matched += matchingSize(a, b, positions, alo, i, blo, j)
	}
	if i+size < ahi && j+size < bhi {
		matched += matchingSize(a, b, positions, i+size, ahi, j+size, bhi)
	}
	return matched
}

// longestMatch is find_longest_match without junk: the longest common run of
// a[alo:ahi] and b[blo:bhi], the earliest in a and then in b among equals.
func longestMatch(a []rune, positions map[rune][]int, alo, ahi, blo, bhi int) (int, int, int) {
	bestI, bestJ, bestSize := alo, blo, 0
	runs := map[int]int{}
	for i := alo; i < ahi; i++ {
		next := map[int]int{}
		for _, j := range positions[a[i]] {
			if j < blo {
				continue
			}
			if j >= bhi {
				break
			}
			k := runs[j-1] + 1
			next[j] = k
			if k > bestSize {
				bestI, bestJ, bestSize = i-k+1, j-k+1, k
			}
		}
		runs = next
	}
	return bestI, bestJ, bestSize
}
