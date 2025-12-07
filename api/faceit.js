export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { path, ...queryParams } = req.query;
    
    if (!path) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const apiUrl = `https://open.faceit.com/data/v4/${path}`;
    
    const url = new URL(apiUrl);
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value && value !== 'undefined') {
        url.searchParams.set(key, value);
      }
    });

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${process.env.FACEIT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ 
        error: `Faceit API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
