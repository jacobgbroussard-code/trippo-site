async function getMinGitUrl() {
    try {
        const res = await fetch('https://api.github.com/repos/git-for-windows/git/releases/latest');
        const data = await res.json();
        const minGitAsset = data.assets.find(a => a.name.startsWith('MinGit') && a.name.includes('64-bit.zip'));
        console.log('MinGit asset:', minGitAsset ? minGitAsset.browser_download_url : 'not found');
        return minGitAsset?.browser_download_url;
    } catch (e) {
        console.error(e);
    }
}
getMinGitUrl();
