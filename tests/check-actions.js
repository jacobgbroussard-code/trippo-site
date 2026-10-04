async function checkActions() {
    const res = await fetch('https://api.github.com/repos/jacobgbroussard-code/trippo-site/actions/runs');
    if (res.ok) {
        const data = await res.json();
        console.log('Action runs count:', data.total_count);
        if (data.workflow_runs && data.workflow_runs.length > 0) {
            console.log('Latest run:', {
                name: data.workflow_runs[0].name,
                status: data.workflow_runs[0].status,
                conclusion: data.workflow_runs[0].conclusion,
                html_url: data.workflow_runs[0].html_url
            });
        }
    } else {
        console.log('Actions status:', res.status);
    }
}
checkActions();
