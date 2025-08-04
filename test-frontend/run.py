#!/usr/bin/env python3

import os
import sys
from pathlib import Path

# Add the current directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

from app import app

if __name__ == '__main__':
    # Get port from environment or use default
    port = int(os.environ.get('PORT', 3000))
    
    # Run the application
    app.run(
        host='0.0.0.0',
        port=port,
        debug=os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'
    )