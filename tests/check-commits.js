async function checkCommits() {
    const res = await fetch('https://api.github.com/repos/jacobgbroussard-code/trippo-site/commits');
    const commits = await res.json();
    console.log(commits.map(c => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message,
        date: c.commit.committer.date
    })));
}
checkCommits();
